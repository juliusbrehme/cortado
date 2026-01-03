import { ZoomFieldComponent } from '../zoom-field/zoom-field.component';
import { VariantService } from '../../services/variantService/variant.service';
import { BackendService } from 'src/app/services/backendService/backend.service';
import { VariantExplorerComponent } from '../variant-explorer/variant-explorer.component';
import { GoldenLayoutComponentService } from '../../services/goldenLayoutService/golden-layout-component.service';
import { ColorMapService } from '../../services/colorMapService/color-map.service';
import { ComponentContainer, LogicalZIndex } from 'golden-layout';
import { SharedDataService } from 'src/app/services/sharedDataService/shared-data.service';
import Swal from 'sweetalert2';
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
  ChoiceGroup,
  OperatorGroup,
  FallthroughGroup,
  StartNode,
  EndNode,
  WildcardNode,
  AnythingNode,
} from 'src/app/objects/Variants/variant_element';
import { collapsingText, fadeInText } from 'src/app/animations/text-animations';
import { findPathToSelectedNode } from 'src/app/objects/Variants/utility_functions';
import { applyInverseStrokeToPoly } from 'src/app/utils/render-utils';
import { Observable, of, Subject } from 'rxjs';
import { first, takeUntil, tap } from 'rxjs/operators';
import { VariantFilterService } from 'src/app/services/variantFilterService/variant-filter.service';
import {
  LogicTreeNode,
  QueryLogicTreeComponent,
} from '../query-logic-tree/query-logic-tree.component';

@Component({
  selector: 'app-variant-query-modeler',
  templateUrl: './variant-query-modeler.component.html',
  styleUrls: ['./variant-query-modeler.component.css'],
  animations: [fadeInText, collapsingText],
})
export class VariantQueryModelerComponent
  extends LayoutChangeDirective
  implements OnInit, OnDestroy
{
  logicTree: LogicTreeNode = {
    id: 'root',
    type: 'plus',
  };

  // Map to track all variant nodes by their variantIndex
  queryNodes: Map<number, LogicTreeNode> = new Map();

  // Currently selected variant for editing with toolbar
  currentEditingQueryId: number | null = null;

  // Floating operator editor state
  editorVisible: boolean = false;
  editorX: number = 0;
  editorY: number = 0;
  editorValue: number | string = '';
  private editorTarget: any = null; // OperatorGroup

  activityNames: Array<String> = [];

  customActivities: boolean = true;

  public colorMap: Map<string, string>;

  VariantQueryModelerComponent = VariantQueryModelerComponent;

  @ViewChild('VariantMainGroup')
  variantElement: ElementRef;

  @ViewChild(ZoomFieldComponent)
  editor: ZoomFieldComponent;

  @ViewChild(VariantDrawerDirective)
  variantDrawer: VariantDrawerDirective;

  @ViewChild(QueryLogicTreeComponent, { static: false })
  queryLogicTreeComponent: QueryLogicTreeComponent;

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

  // Query type selection for visual pattern matching
  public queryType: 'DFS' | 'BFS' | 'RELAXED_NG' = 'BFS';

  private _destroy$ = new Subject();

  constructor(
    private sharedDataService: SharedDataService,
    private logService: LogService,
    private variantService: VariantService,
    private backendService: BackendService,
    private variantFilterService: VariantFilterService,
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

  onTreeUpdated(updatedTree: LogicTreeNode) {
    this.logicTree = updatedTree;
    // Update the variant nodes map whenever tree changes
    this.queryNodes.clear();
    this.collectQueryNodes(updatedTree);
  }

  private collectQueryNodes(node: LogicTreeNode) {
    if (!node) return;

    if (node.type === 'query' && node.queryId) {
      this.queryNodes.set(node.queryId, node);
    }

    if (node.children) {
      node.children.forEach((child) => this.collectQueryNodes(child));
    }
  }

  onQueryCreated(event: { node: LogicTreeNode; variantIndex: number }) {
    const { node, variantIndex } = event;
    // Store the variant node
    this.queryNodes.set(variantIndex, node);
  }

  selectVariantForEditing(queryId: number, node: LogicTreeNode) {
    // Save current variant back to the tree node before switching
    const previousId = this.currentEditingQueryId;
    if (previousId !== null && this.queryNodes.has(previousId)) {
      const previousNode = this.queryNodes.get(previousId);
      if (previousNode) {
        // Deep clone to ensure we capture the current state
        previousNode.variantElement = cloneDeep(this.currentVariant);
      }
    }

    // Load the new variant into the main editor
    this.currentEditingQueryId = queryId;

    // Check if variant has content or is empty
    if (node.variantElement) {
      // Deep clone when loading to avoid reference issues
      this.currentVariant = cloneDeep(node.variantElement);
      this.emptyVariant = false;
    } else {
      this.currentVariant = null;
      this.emptyVariant = true;
    }

    // Reset the cache with the new variant
    this.cachedVariants = [
      this.currentVariant ? cloneDeep(this.currentVariant) : null,
    ];
    this.cacheIdx = 0;

    // Clear selection
    this.selectedElement = null;
    this.multipleSelected = false;

    if (this.variantDrawer) {
      this.variantDrawer.redraw();
    }

    if (this.editor) {
      this.editor.centerContent(0);
    }
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

  onOperatorAction(event: any) {
    if (!event || !event.action) return;
    if (event.action === 'editLoopSize') {
      const opGroup = event.element || (event.elements && event.elements[0]);
      if (!opGroup) return;
      this.editorTarget = opGroup;
      this.editorValue =
        (opGroup.operatorFlags && opGroup.operatorFlags.loopSize) || '';

      const winX = event.clientX || window.innerWidth / 2;
      const winY = event.clientY || window.innerHeight / 2;
      this.editorX = Math.max(8, winX + 8);
      this.editorY = Math.max(8, winY + 8);
      this.editorVisible = true;
      setTimeout(() => {
        const el = document.querySelector(
          '.floating-editor input'
        ) as HTMLInputElement;
        if (el) el.focus();
      });
    }
  }

  applyEditor() {
    if (!this.editorTarget) return;
    const n = Number(this.editorValue);
    if (!isNaN(n) && n >= 0) {
      if (!this.editorTarget.operatorFlags)
        this.editorTarget.operatorFlags = {};
      this.editorTarget.operatorFlags.loopSize = n;
      if (this.variantDrawer) this.variantDrawer.redraw();
    }
    this.editorVisible = false;
    this.editorTarget = null;
  }

  cancelEditor() {
    this.editorVisible = false;
    this.editorTarget = null;
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
    leaf: VariantElement,
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
    leaf: VariantElement,
    selectedElement
  ) {
    const children = variant.getElements();

    if (variant instanceof ChoiceGroup || variant instanceof FallthroughGroup) {
      this.fireAlert(
        'Parallel Insertion Error',
        'Cannot insert parallel activities into this operator group.',
        'info'
      );
      return;
    }

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
    //this.curInfixType = infixtype;
  }

  handleBehindInsert(
    variant: VariantElement,
    leaf: VariantElement,
    selectedElement
  ) {
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
    leaf: VariantElement,
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

  handleReplace(
    variant: VariantElement,
    leaf: VariantElement,
    selectedElement
  ) {
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

  onOperatorSelected(operatorType: string) {
    const selectedElements = this.variantEnrichedSelection
      .selectAll('.selected-variant-g')
      .data();

    // If nothing selected, nothing to do
    if (!selectedElements || selectedElements.length === 0) {
      this.fireAlert(
        'Selection Error',
        'Please select at least one activity to apply the operator.',
        'info'
      );
      return;
    }

    // We want only one parent so we select just one and check if the selection is valid
    const parent = this.findParent(this.currentVariant, selectedElements[0]);
    if (!parent) return;

    const children = parent.getElements();

    // If our selection is within an OperatorGroup, we do not allow nesting
    if (parent instanceof OperatorGroup && selectedElements.length === 1) {
      // We toggle the operator on the existing OperatorGroup
      this.toggleOperatorGroup(parent, operatorType);
      return;
    }

    if (parent instanceof FallthroughGroup || parent instanceof ChoiceGroup) {
      this.fireAlert(
        'Operator Group Error',
        'Cannot apply operator groups within Fallthrough or Choice Groups.',
        'info'
      );
      return;
    }

    if (
      selectedElements.length === 1 &&
      selectedElements[0] instanceof OperatorGroup
    ) {
      // We toggle the operator on the existing OperatorGroup
      this.toggleOperatorGroup(
        selectedElements[0] as OperatorGroup,
        operatorType
      );
      return;
    }

    // The index where to insert the OperatorGroup
    let first_idx = -1;
    // Check if all selected elements have the same parent and are continuous
    let current_idx = -1;
    for (const leaf of selectedElements) {
      const leaf_parent = this.findParent(this.currentVariant, leaf);
      if (parent !== leaf_parent) return;
      const idx = children.indexOf(leaf);
      if (current_idx == -1) {
        current_idx = idx;
        first_idx = idx;
      } else if (idx !== current_idx + 1) {
        // Not continuous selection
        return;
      }
      if (idx === -1) return;
    }

    // Remove selected elements from parent's children
    children.splice(first_idx, selectedElements.length);

    const operator = new OperatorGroup(selectedElements as VariantElement[]);
    if (operatorType === 'repeatable') {
      operator.toggleRepeatable();
    } else if (operatorType === 'optional') {
      operator.toggleOptional();
    }

    children.splice(first_idx, 0, operator);
    parent.setElements(children);

    this.cacheCurrentVariant();
    this.triggerRedraw();
  }

  toggleOperatorGroup(group: OperatorGroup, operatorType: string) {
    if (operatorType === 'repeatable') {
      group.toggleRepeatable();
    } else if (operatorType === 'optional') {
      group.toggleOptional();
    }
    // If we toggled off both operators, we remove the OperatorGroup
    if (group.getRepeatable() === false && group.getOptional() === false) {
      // If both operators are off, we remove the OperatorGroup
      const grandParent = this.findParent(this.currentVariant, group);
      const grandChildren = grandParent.getElements();
      const parentIdx = grandChildren.indexOf(group);
      // Remove the OperatorGroup and insert its children in its place
      grandChildren.splice(parentIdx, 1, ...group.getElements());
      grandParent.setElements(grandChildren);
    }
    this.cacheCurrentVariant();
    this.triggerRedraw();
  }

  onRepeatableSelected() {
    this.onOperatorSelected('repeatable');
  }

  onOptionalSelected() {
    this.onOperatorSelected('optional');
  }

  /** Handler for ChoiceGroup creation
   *  Constraints:
   *  - Only a single LeafNode can be selected
   */
  onChoiceSelected() {
    const selectedElements = this.variantEnrichedSelection
      .selectAll('.selected-variant-g')
      .data();
    // If nothing selected, nothing to do
    if (!selectedElements || selectedElements.length === 0) {
      this.fireAlert(
        'Selection Error',
        'Please select at least one activity to apply the operator.',
        'info'
      );
      return;
    }
    // If selection is a single LeafNode, replace it by a ChoiceGroup containing that element
    if (
      selectedElements.length === 1 &&
      selectedElements[0] instanceof LeafNode
    ) {
      const leaf = selectedElements[0] as LeafNode;
      const parent = this.findParent(this.currentVariant, leaf);
      if (!parent) return;
      else if (!(leaf instanceof LeafNode)) {
        this.fireAlert(
          'Choice Group Error',
          'A Choice Group can just contain Leaf Nodes.',
          'info'
        );
        return;
      } else if (parent instanceof FallthroughGroup) {
        this.fireAlert(
          'Choice Group Error',
          'Cannot insert operator into a Fallthrough Group.',
          'info'
        );
        return;
      }

      const children = parent.getElements();
      const idx = children.indexOf(leaf);
      if (idx === -1) return;

      // Replace the leaf with a ChoiceGroup containing the leaf and an empty LeafNode
      const choice = new ChoiceGroup([leaf]);
      children.splice(idx, 1, choice);
      parent.setElements(children);
      this.cacheCurrentVariant();
      this.triggerRedraw();
      return;
    }
    this.fireAlert(
      'Choice Group Error',
      'A Choice Group can just contain Leaf Nodes.',
      'info'
    );
  }

  onFallthroughSelected() {
    const selectedElements = this.variantEnrichedSelection
      .selectAll('.selected-variant-g')
      .data();
    // If nothing selected, nothing to do
    if (!selectedElements || selectedElements.length === 0) {
      this.fireAlert(
        'Selection Error',
        'Please select at least one activity to apply the operator.',
        'info'
      );
      return;
    }

    // We want only one parent so we select just one and check if the selection is valid
    const parent = this.findParent(this.currentVariant, selectedElements[0]);
    if (!parent) return;

    if (parent instanceof ChoiceGroup) {
      this.fireAlert(
        'Fallthrough Group Error',
        'Cannot insert operator into a Choice Group.',
        'info'
      );
      return;
    }

    const children = parent.getElements();

    if (
      selectedElements.length === 1 &&
      selectedElements[0] instanceof FallthroughGroup
    ) {
      return;
    }

    // The index where to insert the FallthroughGroup
    let first_idx = -1;
    // Check if all selected elements have the same parent and are continuous
    let current_idx = -1;
    for (const leaf of selectedElements) {
      if (!(leaf instanceof LeafNode)) {
        this.fireAlert(
          'Fallthrough Group Error',
          'A Fallthrough Group can just contain Leaf Nodes.',
          'info'
        );
        return;
      }
      const leaf_parent = this.findParent(this.currentVariant, leaf);
      if (parent !== leaf_parent) return;
      const idx = children.indexOf(leaf);
      if (current_idx == -1) {
        current_idx = idx;
        first_idx = idx;
      } else if (idx !== current_idx + 1) {
        // Not continuous selection
        return;
      }
      if (idx === -1) return;
    }

    // Remove selected elements from parent's children
    children.splice(first_idx, selectedElements.length);

    const fallthrough = new FallthroughGroup(
      selectedElements as VariantElement[]
    );

    children.splice(first_idx, 0, fallthrough);
    parent.setElements(children);

    this.cacheCurrentVariant();
    this.triggerRedraw();
  }

  onAddWildcardSelected() {
    const leaf = new WildcardNode();
    this.insertCustomNode(leaf);
  }

  onAddAnythingOperatorSelected() {
    const leaf = new AnythingNode();
    this.insertCustomNode(leaf);
  }

  onAddStartOperatorSelected() {
    const leaf = new StartNode();
    this.insertStartEndNodes(leaf);
  }

  onAddEndOperatorSelected() {
    const leaf = new EndNode();
    this.insertStartEndNodes(leaf);
  }

  // Handler for actions emitted by the variant-modeler context menu
  onContextMenuAction(event: { action: string; value: any }) {
    if (!event || !event.action) return;

    if (event.action === 'delete') {
      this.onDeleteSelected();
    }

    if (event.action === 'repeatable') {
      this.onRepeatableSelected();
    }

    if (event.action === 'optional') {
      this.onOptionalSelected();
    }

    if (event.action === 'fallthrough') {
      this.onFallthroughSelected();
    }

    if (event.action === 'choice') {
      this.onChoiceSelected();
    }

    if (event.action === 'wildcard') {
      this.onAddWildcardSelected();
    }

    if (event.action === 'anything') {
      this.onAddAnythingOperatorSelected();
    }
    // Dont need those anymore

    if (event.action === 'start') {
      this.onAddStartOperatorSelected();
    }

    if (event.action === 'end') {
      this.onAddEndOperatorSelected();
    }
  }

  fireAlert(title: string, text: string, icon: any = 'info') {
    Swal.fire({
      title: '<tspan>' + title + '</tspan>',
      html: '<b>' + text + '</b>',
      icon: icon,
      //position: "bottom-end",
      showCloseButton: true,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: 'close',
      //timer: 2000,
    });
  }

  insertStartEndNodes(node: StartNode | EndNode) {
    const children = this.currentVariant.getElements();
    if (node instanceof StartNode) {
      const firstChild = children[0];
      if (firstChild instanceof StartNode) {
        this.fireAlert(
          'Node placement not valid',
          'A start node is already present at the beginning of the variant.',
          'info'
        );
        return;
      }
      children.splice(0, 0, node);
    } else if (node instanceof EndNode) {
      const lastChild = children[children.length - 1];
      if (lastChild instanceof EndNode) {
        this.fireAlert(
          'Node placement not valid',
          'An end node is already present at the end of the variant.',
          'info'
        );
        return;
      }
      children.splice(children.length, 0, node);
    }
    this.currentVariant.setElements(children);
    this.triggerRedraw();
    this.cacheCurrentVariant();
  }

  insertCustomNode(node: VariantElement) {
    if (this.selectedElement || this.emptyVariant) {
      const leaf = node;
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

  resetAll() {
    // Reset logic tree to initial state
    this.logicTree = {
      id: 'root',
      type: 'plus',
    };

    // Clear all variant nodes
    this.queryNodes.clear();

    // Reset current editing state
    this.currentEditingQueryId = null;
    this.currentVariant = null;
    this.emptyVariant = true;

    // Reset cache
    this.cachedVariants = [null];
    this.cacheIdx = 0;

    // Clear selections
    this.selectedElement = false;
    this.multiSelect = false;
    this.multipleSelected = false;

    // Trigger tree update
    this.onTreeUpdated(this.logicTree);

    // Trigger redraw
    this.triggerRedraw();

    // Center both editors after a short delay to allow rendering
    if (this.queryLogicTreeComponent) {
      this.queryLogicTreeComponent.recenterAfterUpdate();
    }
    // Center variant editor
    if (this.editor) {
      this.editor.centerContent(0);
    }
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

  onQueryTypeChange() {
    // selection change handled by two-way binding on `queryType`
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

  onFilterVariants() {
    const current = this.currentVariant;
    //this.variantService.variants = [];
    let variantQuery = current.serialize(1);
    const observable = this.backendService.visualQuery(
      variantQuery,
      this.queryType
    );
    observable.subscribe((res) => {
      const variant_ids = res;
      const variants = [];
      this.variantFilterService.addVariantFilter(
        'query filter',
        new Set(res as Array<number>),
        'Testing variant query filter'
      );
    });
  }

  onFilterCurrentQuery() {
    // Filter using only the currently selected query
    if (this.currentEditingQueryId === null || !this.currentVariant) {
      return;
    }

    const variantQuery = this.currentVariant.serialize(1);
    const observable = this.backendService.visualQuery(
      variantQuery,
      this.queryType
    );
    observable.subscribe((res) => {
      this.variantFilterService.addVariantFilter(
        `Query #${this.currentEditingQueryId} filter`,
        new Set(res as Array<number>),
        `Filter based on Query #${this.currentEditingQueryId}`
      );
    });
  }

  isFilterable(): boolean {
    if (this.logicTree === null) {
      return false;
    }
    return false;
  }

  onFilterLogicTree() {
    // Filter using only the currently selected query
    if (this.logicTree === null) {
      return;
    }

    const observable = this.backendService.visualQueryLogical(
      this.logicTree,
      this.queryType
    );
    //TODO: subscribe and add filter
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

  applySortOnVariantQueryModeler() {
    const variantExplorerRef =
      this.goldenLayoutComponentService.goldenLayout.findFirstComponentItemById(
        VariantExplorerComponent.componentName
      );
    const variantExplorer =
      variantExplorerRef.component as VariantExplorerComponent;
    variantExplorer.sortingFeature = 'userDefined';
    variantExplorer.onSortOrderChanged(false);
  }
}

export namespace VariantQueryModelerComponent {
  export const componentName = 'VariantQueryModelerComponent';
}

export enum activityInsertionStrategy {
  infront = 'infront',
  behind = 'behind',
  parallel = 'parallel',
  replace = 'replace',
}
