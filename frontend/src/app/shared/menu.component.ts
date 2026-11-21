// A 3-dots button that opens a small menu (Batch 7). One menu for the whole
// system: learner actions on the Classes page, Mark on the Attendance page.
// Closes on selection, on Escape and on a click outside. The menu never
// closes its parent modal: it stops its own Escape key, and a backdrop click
// does not close modals at all.
//
//   <app-menu
//     [items]="[{ value: 'edit', label: 'Edit' }, { value: 'delete', label: 'Delete', danger: true }]"
//     [selected]="currentStatus"
//     (picked)="onMenu($event)" />
import { Component, ElementRef, inject, input, output, signal } from '@angular/core';
import { IconComponent } from './icon.component';

export interface MenuItem {
  value: string;
  label: string;
  danger?: boolean;
}

@Component({
  selector: 'app-menu',
  imports: [IconComponent],
  template: `
    <div class="menu-wrap">
      <button
        type="button"
        class="icon-btn menu-btn"
        [attr.aria-label]="label()"
        [attr.aria-expanded]="open()"
        [attr.aria-haspopup]="true"
        (click)="toggle()"
        (keydown.escape)="onEscape($event)"
      >
        <app-icon name="dots" [size]="18" />
      </button>
      @if (open()) {
        <div class="menu" role="menu">
          @for (item of items(); track item.value) {
            <button
              type="button"
              class="menu-item"
              [class.danger]="item.danger"
              [class.selected]="item.value === selected()"
              role="menuitem"
              (click)="pick(item.value)"
            >
              <span>{{ item.label }}</span>
              @if (item.value === selected()) {
                <app-icon name="check" [size]="15" />
              }
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .menu-wrap {
      position: relative;
      display: inline-block;
    }

    .menu-btn {
      width: 34px;
      height: 34px;
    }

    .menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: 70;
      min-width: 170px;
      padding: 4px;
      border-radius: 8px;
      border: 1px solid var(--border-strong);
      background: var(--surface);
      box-shadow: var(--shadow-lg);
    }

    .menu-item {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 10px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--ink);
      font: inherit;
      font-size: 14px;
      text-align: left;
      cursor: pointer;
    }

    .menu-item:hover {
      background: var(--surface-3);
    }

    .menu-item.selected {
      background: var(--accent-tint);
      font-weight: 600;
    }

    .menu-item.selected app-icon {
      color: var(--accent);
    }

    .menu-item.danger {
      color: var(--red);
    }

    .menu-item.danger:hover {
      background: var(--red-tint);
    }
  `,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onDocumentEscape()',
  },
})
export class MenuComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly items = input.required<MenuItem[]>();
  readonly label = input('More actions');
  // The value to mark as selected (for example the learner's current status).
  readonly selected = input<string | null>(null);
  readonly picked = output<string>();

  readonly open = signal(false);

  toggle(): void {
    this.open.set(!this.open());
  }

  pick(value: string): void {
    this.open.set(false);
    this.picked.emit(value);
  }

  onEscape(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation();
    this.open.set(false);
  }

  onDocumentEscape(): void {
    if (this.open()) this.open.set(false);
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
