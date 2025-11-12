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

  constructor() {}

  deleteDisabled(element: VariantElement) {
    return !element;
  }

  @Output()
  public menuAction: EventEmitter<{ action: string; value: any }> =
    new EventEmitter();

  onDelete(action: ContextMenuAction<VariantElement>) {
    console.log('onDelete action:', action);
    if (!action.value) return;
    // emit a delete action to the parent VariantModelerComponent which performs
    // the actual model mutation (keeps this component UI-only)
    this.menuAction.emit({ action: 'delete', value: action.value });
  }

  onMakeOptional(action: ContextMenuAction<VariantElement>) {
    if (!action.value) return;
    // make optional
  }

  onMakeRepeatable(action: ContextMenuAction<VariantElement>) {
    if (!action.value) return;
    // make repeatable
  }

  makeOptionalDisabled(element: VariantElement) {
    return !element;
  }

  makeRepeatableDisabled(element: VariantElement) {
    return !element;
  }
}
