import { ZoomFieldComponent } from '../zoom-field/zoom-field.component';
import { VariantService } from '../../services/variantService/variant.service';
import { BackendService } from 'src/app/services/backendService/backend.service';
import { VariantExplorerComponent } from '../variant-explorer/variant-explorer.component';
import { GoldenLayoutComponentService } from '../../services/goldenLayoutService/golden-layout-component.service';
import { ColorMapService } from '../../services/colorMapService/color-map.service';
import { ComponentContainer, LogicalZIndex } from 'golden-layout';
import { SharedDataService } from 'src/app/services/sharedDataService/shared-data.service';
import {
  Component,
  ElementRef,
  Inject,
  OnInit,
  Renderer2,
  ViewChild,
  HostListener,
  OnDestroy,
} from '@angular/core';

import { cloneDeep } from 'lodash';
import { select, Selection } from 'd3';
import * as objectHash from 'object-hash';
import * as d3 from 'd3';
import { LogService } from 'src/app/services/logService/log.service';
import { LayoutChangeDirective } from 'src/app/directives/layout-change/layout-change.directive';
import { VariantDrawerDirective } from 'src/app/directives/variant-drawer/variant-drawer.directive';
import { InfixType, setParent } from 'src/app/objects/Variants/infix_selection';
import { FragmentStatistics, Variant } from 'src/app/objects/Variants/variant';
import {
  deserialize,
  LeafNode,
  ParallelGroup,
  SequenceGroup,
  VariantElement,
} from 'src/app/objects/Variants/variant_element';
import { collapsingText, fadeInText } from 'src/app/animations/text-animations';
import { findPathToSelectedNode } from 'src/app/objects/Variants/utility_functions';
import { applyInverseStrokeToPoly } from 'src/app/utils/render-utils';
import { Observable, of, Subject } from 'rxjs';
import { first, takeUntil, tap } from 'rxjs/operators';

@Component({
  selector: 'app-variant-modeler',
  templateUrl: './variant-modeler.component.html',
  styleUrls: ['./variant-modeler.component.css'],
  animations: [fadeInText, collapsingText],
})
export class VariantModelerComponent
  extends LayoutChangeDirective
  implements OnInit, OnDestroy
{
  activityNames: Array<String> = [];

  public colorMap: Map<string, string>;

  VariantModelerComponent = VariantModelerComponent;

  @ViewChild('VariantMainGroup')
  variantElement: ElementRef;

  @ViewChild(ZoomFieldComponent)
  editor: ZoomFieldComponent;

  @ViewChild(VariantDrawerDirective)
  variantDrawer: VariantDrawerDirective;

  currentVariant: VariantElement = null;

  cachedVariants: VariantElement[] = [null]; // edited
  cacheSize: number = 100;
  cacheIdx: number = 0;

  emptyVariant: boolean = true;

  selectedElement = false;
  multiSelect = false;
  multipleSelected = false;

  infixType = InfixType;
  curInfixType = InfixType.NOT_AN_INFIX;

  newLeaf;

  collapse: boolean = false;

  insertionStrategy = activityInsertionStrategy;
  selectedStrategy = this.insertionStrategy.behind;

  variantEnrichedSelection: Selection<any, any, any, any>;
  zoom: any;

  redundancyWarning = false;

  private _destroy$ = new Subject();

  constructor(
    private sharedDataService: SharedDataService,
    private logService: LogService,
    private variantService: VariantService,
    private backendService: BackendService,
    private colorMapService: ColorMapService,
    @Inject(LayoutChangeDirective.GoldenLayoutContainerInjectionToken)
    private container: ComponentContainer,
    private goldenLayoutComponentService: GoldenLayoutComponentService,
    elRef: ElementRef,
    renderer: Renderer2
  ) {
    super(elRef.nativeElement, renderer);
  }

  ngOnInit(): void {
    this.logService.activitiesInEventLog$
      .pipe(takeUntil(this._destroy$))
      .subscribe((activities) => {
        this.activityNames = [];
        for (const activity in activities) {
          this.activityNames.push(activity);
          this.activityNames.sort();
        }
      });

    this.logService.loadedEventLog$
      .pipe(takeUntil(this._destroy$))
      .subscribe((newLog) => {
        if (newLog) {
          this.emptyVariant = true;
        }
      });

    this.colorMapService.colorMap$
      .pipe(takeUntil(this._destroy$))
      .subscribe((map) => {
        this.colorMap = map;
        if (this.variantDrawer) {
          this.variantDrawer.redraw();
        }
      });
  }

  ngOnDestroy(): void {
    this._destroy$.next();
  }

  handleResponsiveChange(
    left: number,
    top: number,
    width: number,
    height: number
  ): void {
    this.collapse = width < 1150;
  }

  handleVisibilityChange(visibility: boolean): void {}

  handleZIndexChange(
    logicalZIndex: LogicalZIndex,
    defaultZIndex: string
  ): void {}

  handleRedraw(selection: Selection<any, any, any, any>) {
    selection.selectAll('g').on('click', function (event, _) {
      event.stopPropagation();
      const select = d3.select(this as SVGElement);
      toogleSelect(select);
    });
    const toogleSelect = function (svgSelection) {
      if (!this.multiSelect) {
        d3.select('#VariantMainGroup')
          .selectAll('.selected-polygon')
          .classed('selected-polygon', false)
          .attr('stroke', false);

        d3.select('#VariantMainGroup')
          .selectAll('.chevron-group')
          .style('fill-opacity', 0.5);

        d3.select('#VariantMainGroup')
          .selectAll('.selected-variant-g')
          .classed('selected-variant-g', false);

        svgSelection.classed('selected-variant-g', true);

        const poly = svgSelection.select('polygon');
        poly.classed('selected-polygon', true);

        this.multipleSelected = false;
      } else {
        this.multipleSelected = true;

        svgSelection.classed(
          'selected-variant-g',
          !svgSelection.classed('selected-variant-g')
        );

        const poly = svgSelection.select('polygon');

        poly.classed('selected-polygon', !poly.classed('selected-polygon'));

        // If one is selected reactivate insert
        if (
          d3
            .select('#VariantMainGroup')
            .selectAll('.selected-variant-g')
            .nodes().length == 1
        ) {
          this.multipleSelected = false;
        }
      }
      this.selectedElement = true;
    }.bind(this);

    selection.selectAll('g').classed('selected-variant-g', (d) => {
      return d === this.newLeaf;
    });

    if (!(selection.selectAll('.selected-variant-g').nodes().length > 0)) {
      this.selectedElement = false;
    }

    this.variantEnrichedSelection = selection;
  }

  handleActivityButtonClick(event) {
    if (this.selectedElement || this.emptyVariant) {
      const leaf = new LeafNode([event.activityName]);
      this.newLeaf = leaf;

      // hide tooltip
      if (this.variantService.activityTooltipReference) {
        this.variantService.activityTooltipReference.tooltip('hide');
      }

      if (this.emptyVariant) {
        const variantGroup = new SequenceGroup([leaf]);
        variantGroup.setExpanded(true);
        this.currentVariant = variantGroup;
        this.emptyVariant = false;
        this.selectedElement = true;
      } else {
        leaf.setExpanded(true);
        const selectedElement = this.variantEnrichedSelection
          .selectAll('.selected-variant-g')
          .data()[0];

        switch (this.selectedStrategy) {
          case this.insertionStrategy.infront:
            if (!this.multipleSelected) {
              this.handleInfrontInsert(
                this.currentVariant,
                leaf,
                selectedElement
              );
              const grandParent = this.findParent(
                this.currentVariant,
                this.findParent(this.currentVariant, leaf)
              );
              if (grandParent instanceof ParallelGroup) {
                this.sortParallel(grandParent);
              }
            }
            break;
          case this.insertionStrategy.behind:
            if (!this.multipleSelected) {
              this.handleBehindInsert(
                this.currentVariant,
                leaf,
                selectedElement
              );
              const grandParent = this.findParent(
                this.currentVariant,
                this.findParent(this.currentVariant, leaf)
              );
              if (grandParent instanceof ParallelGroup) {
                this.sortParallel(grandParent);
              }
            }
            break;
          case this.insertionStrategy.parallel:
            if (!this.multipleSelected) {
              this.handleParallelInsert(
                this.currentVariant,
                leaf,
                selectedElement
              );
            } else {
              const selectedElements = this.variantEnrichedSelection
                .selectAll('.selected-variant-g')
                .data();
              this.handleMultiParallelInsert(
                this.currentVariant,
                leaf,
                selectedElements
              );
            }
            this.sortParallel(this.findParent(this.currentVariant, leaf));
            break;
          case this.insertionStrategy.replace:
            if (!this.multipleSelected) {
              this.handleReplace(this.currentVariant, leaf, selectedElement);
            }
            break;
        }
        this.triggerRedraw();
      }
      this.cacheCurrentVariant();
    }
  }

  copyVariant(variant: VariantElement) {
    const children = variant.getElements();
    if (variant instanceof LeafNode) {
      return new LeafNode([variant.asLeafNode().activity[0]]);
    } else {
      const newChildren = [];
      for (const child of children) {
        newChildren.push(this.copyVariant(child));
      }
      variant.setElements(newChildren);
      return variant;
    }
  }

  handleMultiParallelInsert(
    variant: VariantElement,
    leaf: LeafNode,
    selectedElement
  ) {
    const parent = this.findParent(variant, selectedElement[0]);
    const grandParent = this.findParent(variant, parent); // if parent is root, grandParent is null
    const children = parent.getElements();
    if (
      children.length === selectedElement.length &&
      grandParent &&
      grandParent instanceof ParallelGroup
    ) {
      const parentSiblings = grandParent.getElements();
      parentSiblings.splice(0, 0, leaf);
      grandParent.setElements(parentSiblings);
    } else {
      const index = children.indexOf(selectedElement[0]);
      const newParent = new ParallelGroup([
        leaf,
        new SequenceGroup(selectedElement),
      ]);
      children.splice(index, selectedElement.length);
      children.splice(index, 0, newParent);
      parent.setElements(children);
    }
  }

  handleParallelInsert(
    variant: VariantElement,
    leaf: LeafNode,
    selectedElement
  ) {
    const children = variant.getElements();

    if (children) {
      const index = children.indexOf(selectedElement);
      if (variant && variant === selectedElement) {
        variant.setElements([
          new ParallelGroup([leaf, new SequenceGroup(children)]),
        ]);
      } else if (index > -1) {
        // Handle parent ParallelGroup
        if (variant instanceof ParallelGroup) {
          children.splice(index, 0, leaf);
        } else {
          // If the selected element is a parallel group, insert into its children
          if (selectedElement instanceof ParallelGroup) {
            selectedElement.getElements().push(leaf);

            // Else create a new parallel group for leaf and selected
          } else {
            children.splice(
              index,
              1,
              new ParallelGroup([leaf, selectedElement])
            );
          }
        }
      } else {
        for (const child of children) {
          this.handleParallelInsert(child, leaf, selectedElement);
        }
      }
    }
  }

  handleInfixButtonClick(infixtype: InfixType) {
    this.curInfixType = infixtype;
  }

  handleBehindInsert(variant: VariantElement, leaf: LeafNode, selectedElement) {
    const children = variant.getElements();

    if (children) {
      const index = children.indexOf(selectedElement);
      if (variant && variant === selectedElement) {
        children.splice(children.length, 0, leaf);
      } else if (index > -1) {
        // Handling Parent Parallel Group Cases
        if (variant instanceof ParallelGroup) {
          // Inserting behind a leafNode inside a ParallelGroup
          if (selectedElement instanceof LeafNode) {
            children.splice(
              index,
              1,
              new SequenceGroup([selectedElement, leaf])
            );
          } else {
            // Inserting behind a ParallelGroup inside a ParallelGroup
            if (selectedElement instanceof ParallelGroup) {
              children.splice(
                children.indexOf(selectedElement),
                1,
                new SequenceGroup([selectedElement, leaf])
              );

              // Inserting behind a SequeneGroup inside a ParallelGroup
            } else {
              const selectedChildren = selectedElement.getElements();
              selectedChildren.push(leaf);
            }
          }

          // Else the variant is a SequenceGroup and we can simply insert after the selected Element
        } else {
          children.splice(index + 1, 0, leaf);
        }

        // Recursing into the Children
      } else {
        for (const child of children) {
          this.handleBehindInsert(child, leaf, selectedElement);
        }
      }
    }
  }

  handleInfrontInsert(
    variant: VariantElement,
    leaf: LeafNode,
    selectedElement
  ) {
    const children = variant.getElements();

    if (children) {
      const index = children.indexOf(selectedElement);
      if (variant && variant === selectedElement) {
        children.splice(0, 0, leaf);
      } else if (index > -1) {
        if (variant instanceof ParallelGroup) {
          // Inserting infront a leafNode inside a ParallelGroup
          if (selectedElement instanceof LeafNode) {
            children.splice(
              index,
              1,
              new SequenceGroup([leaf, selectedElement])
            );
          } else {
            // Inserting infront a ParallelGroup inside a ParallelGroup
            if (selectedElement instanceof ParallelGroup) {
              children.splice(
                children.indexOf(selectedElement),
                1,
                new SequenceGroup([leaf, selectedElement])
              );

              // Inserting infront a SequeneGroup inside a ParallelGroup
            } else {
              const selectedChildren = selectedElement.getElements();
              selectedChildren.unshift(leaf);
            }
          }
        } else {
          children.splice(index, 0, leaf);
        }
      } else {
        for (const child of children) {
          this.handleInfrontInsert(child, leaf, selectedElement);
        }
      }
    }
  }

  handleReplace(variant: VariantElement, leaf: LeafNode, selectedElement) {
    const children = variant.getElements();

    if (children) {
      const index = children.indexOf(selectedElement);
      if (variant && variant === selectedElement) {
        variant.setElements([leaf]);
      }
      if (index > -1) {
        children.splice(index, 1, leaf);
      } else {
        for (const child of children) {
          this.handleReplace(child, leaf, selectedElement);
        }
      }
    }
  }

  @HostListener('window:keydown.control', ['$event'])
  onMultiSelectStart() {
    this.multiSelect = true;
  }

  @HostListener('window:keyup.control', ['$event'])
  onMultiSelectStop() {
    this.multiSelect = false;
  }

  onDeleteSelected() {
    const ElementsToDelete = this.variantEnrichedSelection
      .selectAll('.selected-variant-g')
      .data();

    if (
      ElementsToDelete.length === 1 &&
      ElementsToDelete[0] instanceof SequenceGroup &&
      this.currentVariant === ElementsToDelete[0]
    ) {
      this.onDeleteVariant();
    } // need further check. Is this nested function allowed?
    else {
      this.deleteElementFromVariant(
        this.currentVariant,
        this.currentVariant,
        ElementsToDelete
      );

      this.multiSelect = false;
      this.multipleSelected = false;

      this.cacheCurrentVariant();

      this.triggerRedraw();
    }
  }

  computeActivityColor = (
    self: VariantDrawerDirective,
    element: VariantElement
  ) => {
    let color;
    color = this.colorMap.get(element.asLeafNode().activity[0]);

    if (!color) {
      color = '#d3d3d3'; // lightgrey
    }

    return color;
  };

  deleteElementFromVariant(
    variant: VariantElement,
    parent: VariantElement,
    elementsToDelete
  ) {
    const children = variant.getElements();

    if (children) {
      for (const elementToDelete of elementsToDelete) {
        const index = children.indexOf(elementToDelete);
        if (index > -1) {
          this.newLeaf = children[index - 1];

          children.splice(index, 1);
        }
      }

      if (
        children.length === 1 &&
        variant instanceof SequenceGroup &&
        parent instanceof ParallelGroup &&
        (children[0] instanceof ParallelGroup ||
          children[0] instanceof LeafNode)
      ) {
        const childrenParent = parent.getElements();
        const aloneChild = children[0];
        if (aloneChild instanceof LeafNode) {
          childrenParent.splice(childrenParent.indexOf(variant), 1, aloneChild);
        } else {
          const parallelChildren = children[0].getElements();
          const deleteIndex = childrenParent.indexOf(variant);
          childrenParent.splice(deleteIndex, 1);
          for (const newNode of parallelChildren.reverse()) {
            childrenParent.splice(deleteIndex, 0, newNode);
          }
        }
        parent.setElements(childrenParent);
      } else if (
        children.length === 1 &&
        variant instanceof ParallelGroup &&
        parent instanceof SequenceGroup &&
        (children[0] instanceof SequenceGroup ||
          children[0] instanceof LeafNode)
      ) {
        const childrenParent = parent.getElements();
        const aloneChild = children[0];
        if (aloneChild instanceof LeafNode) {
          childrenParent.splice(childrenParent.indexOf(variant), 1, aloneChild);
        } else {
          const sequenceChildren = children[0].getElements();
          const deleteIndex = childrenParent.indexOf(variant);
          childrenParent.splice(deleteIndex, 1);
          for (const newNode of sequenceChildren.reverse()) {
            childrenParent.splice(deleteIndex, 0, newNode);
          }
        }
        parent.setElements(childrenParent);
      }

      // edited
      if (children.length === 0) {
        const childrenParent = parent.getElements();
        if (!(variant === this.currentVariant)) {
          childrenParent.splice(childrenParent.indexOf(variant), 1);
          parent.setElements(childrenParent);
        } else {
          this.currentVariant = null;
          this.emptyVariant = true;
        }
      } else {
        variant.setElements(children);
        for (const child of children) {
          this.deleteElementFromVariant(child, variant, elementsToDelete);
        }
      }
    }
  }

  onDeleteVariant() {
    this.currentVariant = null;
    this.emptyVariant = true;

    this.multiSelect = false;
    this.multipleSelected = false;

    this.cacheCurrentVariant();

    this.triggerRedraw();
  }

  cacheCurrentVariant() {
    if (this.cacheIdx < this.cachedVariants.length - 1) {
      this.cachedVariants = this.cachedVariants.slice(0, this.cacheIdx + 1);
    }

    if (this.currentVariant) {
      this.cachedVariants.push(this.currentVariant.copy());
    } else {
      this.cachedVariants.push(null);
    }
    if (this.cachedVariants.length > this.cacheSize) {
      this.cachedVariants.shift();
    } else {
      if (!(this.cacheIdx == null)) {
        this.cacheIdx += 1;
      } else {
        this.cacheIdx = this.cachedVariants.length - 1;
      }
    }
  }

  compareNode(node1, node2) {
    if (node1 instanceof SequenceGroup) {
      return false;
    } else if (node2 instanceof SequenceGroup) {
      return true;
    } else {
      return node1.asLeafNode().activity[0] > node2.asLeafNode().activity[0];
    }
  }

  /*
  sortParallel(variant) {
    let children = variant.getElements();
    console.log(children);
    //children.sort((node1, node2) => this.compareNode(node1, node2));
    children = children.sort((a, b) => true);
    console.log(children);
    variant.setElements(children);
  }*/
  sortParallel(variant) {
    const children = variant.getElements();
    for (let i = 1; i < children.length; i++) {
      const temp = children[i];
      let j = i - 1;
      while (j >= 0 && this.compareNode(children[j], temp)) {
        children[j + 1] = children[j];
        j--;
      }
      children[j + 1] = temp;
    }
    return children;
  }

  findParent(parent, node) {
    const children = parent.getElements();
    if (!children) {
      return null;
    } else {
      const index = children.indexOf(node);
      if (index > -1) {
        return parent;
      } else {
        for (const child of children) {
          if (this.findParent(child, node) != null) {
            return this.findParent(child, node);
          }
        }
        return null;
      }
    }
  } // check is node is a child of parent

  checkOverlapInsert() {
    if (this.emptyVariant || !this.variantEnrichedSelection) {
      return false;
    } else {
      const selectedElement = this.variantEnrichedSelection
        .selectAll('.selected-variant-g')
        .data()[0];
      const parent = this.findParent(this.currentVariant, selectedElement);
      if (parent && !(parent instanceof ParallelGroup)) {
        return false;
      } else {
        if (!parent) {
          return false;
        } else {
          const siblings = parent.getElements();
          for (const s of siblings) {
            if (s instanceof SequenceGroup && s.getElements().length > 1) {
              return true;
            }
          }
          return false;
        }
      }
    }
  }

  checkNeighborSelection() {
    const selectedElements = this.variantEnrichedSelection
      .selectAll('.selected-variant-g')
      .data();

    if (
      !(
        this.findParent(this.currentVariant, selectedElements[0]) instanceof
        SequenceGroup
      )
    ) {
      return false;
    }

    for (let i = 0; i < selectedElements.length - 1; i++) {
      const firstParent = this.findParent(
        this.currentVariant,
        selectedElements[i]
      );
      const secondParent = this.findParent(
        this.currentVariant,
        selectedElements[i + 1]
      );
      if (
        firstParent != secondParent ||
        firstParent.getElements().indexOf(selectedElements[i + 1]) !=
          firstParent.getElements().indexOf(selectedElements[i]) + 1
      ) {
        return false;
      }
    }
    return true;
  }

  removeSelection() {
    this.selectedElement = false;
    this.multiSelect = false;
    this.multipleSelected = false;

    this.triggerRedraw();
    this.newLeaf = null;
  }

  redo() {
    this.selectedElement = false;
    this.emptyVariant = false;

    this.cacheIdx++;
    if (this.cachedVariants[this.cacheIdx] === null) {
      this.currentVariant = null;
      this.emptyVariant = true;
    } else {
      this.currentVariant = this.cachedVariants[this.cacheIdx].copy();
    }
    this.newLeaf = null;
  }

  undo() {
    this.selectedElement = false;
    this.emptyVariant = false;

    this.cacheIdx--;
    if (this.cachedVariants[this.cacheIdx] === null) {
      this.currentVariant = null;
      this.emptyVariant = true;
    } // edited
    else {
      this.currentVariant = this.cachedVariants[this.cacheIdx].copy();
    }
    this.newLeaf = null;
  }

  // This is a work-around that we should address in a more unified manner
  // The underlying challenge is causing a redraw by triggering change detection,
  // something that in its current state due to only a shallow check of the VariantElement
  triggerRedraw() {
    setTimeout(() => this.variantDrawer.redraw(), 1);
  }

  focusSelected() {
    this.editor.focusSelected(250);
  }

  centerVariant() {
    this.editor.centerContent(250);
  }

  computeFocusOffset = (svg) => {
    const path = findPathToSelectedNode(
      this.currentVariant,
      svg.select('.selected-variant-g').data()[0]
    ).slice(1);
    let translateX = 0;

    for (const element of svg
      .selectAll('g')
      .filter((d: VariantElement) => {
        return path.indexOf(d) > -1;
      })
      .nodes()) {
      const transform = d3
        .select(element)
        .attr('transform')
        .match(/[\d.]+/g);
      translateX += parseFloat(transform[0]);
    }

    return [-translateX, 0];
  };

  addCurrentVariantToVariantList() {
    const copyCurrent = cloneDeep(this.currentVariant);

    setParent(copyCurrent);
    copyCurrent.setExpanded(false);

    const newVariant = new Variant(
      0,
      copyCurrent,
      false,
      true,
      false,
      0,
      undefined,
      true,
      false,
      true,
      0,
      this.curInfixType
    );

    newVariant.alignment = undefined;
    newVariant.deviations = undefined;
    newVariant.id = objectHash(newVariant);

    this.variantService.nUserVariants += 1;
    newVariant.bid = -this.variantService.nUserVariants;

    const duplicate = this.variantService.variants.some((v: Variant) => {
      return newVariant.equals(v) || v.id === newVariant.id;
    });

    if (!duplicate) {
      this.variantService.variants.push(newVariant);
      this.addStatistics(newVariant).subscribe();

      if (newVariant.infixType === InfixType.NOT_AN_INFIX) {
        this.variantService.addUserDefinedVariant(newVariant).subscribe(() => {
          if (this.variantService.clusteringConfig) {
            // trigger new clustering
            this.variantService.clusteringConfig =
              this.variantService.clusteringConfig;
          } else {
            this.variantService.variants = this.variantService.variants;
          }
        });
      } else {
        this.variantService.addInfixToBackend(newVariant).subscribe(() => {
          if (this.variantService.clusteringConfig) {
            // trigger new clustering
            this.variantService.clusteringConfig =
              this.variantService.clusteringConfig;
          } else {
            this.variantService.variants = this.variantService.variants;
          }
        });
      }
    } else {
      this.redundancyWarning = true;
      setTimeout(() => (this.redundancyWarning = false), 500);
    }
  }

  private addStatistics(newVariant: Variant): Observable<any> {
    if (newVariant.infixType !== InfixType.NOT_AN_INFIX) {
      return this.backendService.countFragmentOccurrences(newVariant).pipe(
        tap((statistics: FragmentStatistics) => {
          newVariant.count = statistics.traceOccurrences;
          newVariant.fragmentStatistics = statistics;
        })
      );
    }
    return of();
  }

  applySortOnVariantModeler() {
    const variantExplorerRef =
      this.goldenLayoutComponentService.goldenLayout.findFirstComponentItemById(
        VariantExplorerComponent.componentName
      );
    const variantExplorer =
      variantExplorerRef.component as VariantExplorerComponent;
    variantExplorer.sortingFeature = 'userDefined';
    variantExplorer.onSortOrderChanged(false);
  }

  sortVariant(variant) {
    this.backendService.sortInVariantModeler(variant).subscribe((res) => {
      this.currentVariant = deserialize(res['variants']);
    });
  }
}

export namespace VariantModelerComponent {
  export const componentName = 'VariantModelerComponent';
}

export enum activityInsertionStrategy {
  infront = 'infront',
  behind = 'behind',
  parallel = 'parallel',
  replace = 'replace',
}
