import { Component, ViewChild } from '@angular/core';
import { ContextMenuComponent } from '@perfectmemory/ngx-contextmenu';
import { ContextMenuAction } from 'src/app/objects/ContextMenuAction';
import { ProcessTree } from 'src/app/objects/ProcessTree/ProcessTree';
import { VariantElement } from 'src/app/objects/Variants/variant_element';
import { ProcessTreeService } from 'src/app/services/processTreeService/process-tree.service';

@Component({
  selector: 'app-variant-modeler-context-menu',
  templateUrl: './variant-modeler-context-menu.component.html',
  styleUrls: ['./variant-modeler-context-menu.component.css'],
})
export class VariantModelerContextMenuComponent {
  @ViewChild('contextMenu', { static: true })
  public contextMenu?: ContextMenuComponent<any>;

  constructor() {}

  copyDisabled(pt: ProcessTree) {
    return !pt;
  }

  onCopy(action: ContextMenuAction<ProcessTree>) {
    if (!action.value) return;
    // copy
  }

  pasteDisabled(pt: ProcessTree) {
    return !pt;
  }

  onPaste(action: ContextMenuAction<ProcessTree>) {
    // paste
  }

  deleteDisabled(pt: ProcessTree) {
    return !pt;
  }

  onDelete(action: ContextMenuAction<ProcessTree>) {
    if (!action.value) return;
    // delete
  }
}
