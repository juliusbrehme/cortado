import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VariantModelerContextMenuComponent } from './variant-modeler-context-menu.component';

describe('VariantModelerContextMenuComponent', () => {
  let component: VariantModelerContextMenuComponent;
  let fixture: ComponentFixture<VariantModelerContextMenuComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [VariantModelerContextMenuComponent],
    });
    fixture = TestBed.createComponent(VariantModelerContextMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
