import { Component, ViewChild, Output, EventEmitter } from '@angular/core';
import { ContextMenuComponent } from '@perfectmemory/ngx-contextmenu';
import { ContextMenuAction } from 'src/app/objects/ContextMenuAction';
import { Variant } from 'src/app/objects/Variants/variant';
import { VariantElement } from 'src/app/objects/Variants/variant_element';

@Component({
  selector: 'app-variant-modeler-context-menu',
  templateUrl: './variant-modeler-context-menu.component.html',
  styleUrls: ['./variant-modeler-context-menu.component.css'],
})
export class VariantModelerContextMenuComponent {
  @ViewChild('contextMenu', { static: true })
  public contextMenu?: ContextMenuComponent<any>;

  @Output()
  public menuAction: EventEmitter<{ action: string; value: any }> =
    new EventEmitter();

  constructor() {}

  deleteDisabled(element: VariantElement) {
    return !element;
  }

  onDelete(action: ContextMenuAction<VariantElement>) {
    if (!action.value) return;
    // emit a delete action to the parent VariantModelerComponent which performs
    // the actual model mutation (keeps this component UI-only)
    this.menuAction.emit({ action: 'delete', value: action.value });
  }

  onMakeOptional(action: ContextMenuAction<VariantElement>) {
    if (!action.value) return;
    // make optional
    this.menuAction.emit({ action: 'optional', value: action.value });
  }

  onMakeRepeatable(action: ContextMenuAction<VariantElement>) {
    if (!action.value) return;
    // make repeatable
    this.menuAction.emit({ action: 'repeatable', value: action.value });
  }

  makeOptionalDisabled(element: VariantElement) {
    return !element;
  }

  makeRepeatableDisabled(element: VariantElement) {
    return !element;
  }
}
