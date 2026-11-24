// A 3-dots button that opens a small menu (Batch 7). One menu for the whole
// system: learner actions on the Classes page, Mark on the Attendance page,
// meeting actions on the Schedules page.
// Closes on selection, on Escape, on a click outside, and when its button
// scrolls out of view; any other scroll moves the menu with its button.
// The menu never closes its parent modal: it stops its own Escape
// key, and a backdrop click does not close modals at all.
//
// The open menu is positioned fixed against the viewport, not absolute
// inside its row: an absolute menu is clipped by the table's scrolling
// wrapper (overflow-x: auto) and by cards with overflow: hidden, so on the
// Attendance page the Mark menu for the last rows was cut off at the bottom
// of the table. Raising its z-index cannot fix that — clipping by an
// overflow ancestor ignores z-index. Fixed positioning escapes every
// ancestor, and the menu flips above its button when there is no room
// below it.
//
//   <app-menu
//     [items]="[{ value: 'edit', label: 'Edit' }, { value: 'delete', label: 'Delete', danger: true }]"
//     [selected]="currentStatus"
//     (picked)="onMenu($event)" />
import { DOCUMENT } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
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
        #menuButton
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
        <div
          #menuPanel
          class="menu"
          role="menu"
          [style.top.px]="menuStyle()?.top"
          [style.left.px]="menuStyle()?.left"
        >
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
      display: inline-block;
    }

    .menu-btn {
      width: 34px;
      height: 34px;
    }

    .menu {
      /* Fixed, positioned from the button's viewport rect in placeMenu():
         it must sit above the table, the card and the sticky layout bars,
         and escape every overflow ancestor. */
      position: fixed;
      z-index: 120;
      min-width: 170px;
      max-height: calc(100dvh - 16px);
      overflow-y: auto;
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
    '(window:resize)': 'onViewportChange()',
    '(window:scroll)': 'onViewportChange()',
  },
})
export class MenuComponent implements OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);

  readonly items = input.required<MenuItem[]>();
  readonly label = input('More actions');
  // The value to mark as selected (for example the learner's current status).
  readonly selected = input<string | null>(null);
  readonly picked = output<string>();

  readonly open = signal(false);
  // Viewport coordinates for the fixed menu, set by placeMenu().
  protected readonly menuStyle = signal<{ top: number; left: number } | null>(null);

  private readonly buttonRef = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly menuRef = viewChild<ElementRef<HTMLDivElement>>('menuPanel');
  private scrollListening = false;
  private readonly onScrollCapture = (): void => {
    if (this.open()) this.repositionOrClose();
  };

  ngOnDestroy(): void {
    this.stopScrollClose();
  }

  toggle(): void {
    if (this.open()) {
      this.closeMenu();
      return;
    }
    this.open.set(true);
    // Place from the button rect at once (estimated height until the panel
    // exists), then re-measure the real panel on the next frame so a menu
    // near the bottom edge flips above its button.
    this.placeMenu();
    this.startScrollClose();
    requestAnimationFrame(() => {
      if (this.open()) this.placeMenu();
    });
  }

  pick(value: string): void {
    this.closeMenu();
    this.picked.emit(value);
  }

  private closeMenu(): void {
    this.open.set(false);
    this.menuStyle.set(null);
    this.stopScrollClose();
  }

  // A fixed menu would drift away from its button when anything scrolls,
  // so any scroll — the page, or a scrolling table wrapper, caught in the
  // capture phase because scroll events do not bubble — moves the menu
  // with its button, and closes it once the button has left the viewport.
  // Repositioning (rather than closing) also survives the scroll that
  // follows the opening click itself: a click on a row below the fold
  // scrolls the button into view a few milliseconds later, before the
  // menu has rendered, and closing on that scroll would swallow the open.
  private startScrollClose(): void {
    if (this.scrollListening) return;
    this.document.addEventListener('scroll', this.onScrollCapture, true);
    this.scrollListening = true;
  }

  private stopScrollClose(): void {
    if (!this.scrollListening) return;
    this.document.removeEventListener('scroll', this.onScrollCapture, true);
    this.scrollListening = false;
  }

  onViewportChange(): void {
    if (this.open()) this.repositionOrClose();
  }

  private repositionOrClose(): void {
    const button = this.buttonRef()?.nativeElement;
    if (!button) {
      this.closeMenu();
      return;
    }
    const rect = button.getBoundingClientRect();
    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      this.closeMenu();
      return;
    }
    this.placeMenu();
  }

  // Right-aligned under the button; above it when the menu would run past
  // the bottom of the viewport; clamped inside the viewport either way.
  private placeMenu(): void {
    const button = this.buttonRef()?.nativeElement;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const panel = this.menuRef()?.nativeElement;
    const height = panel?.offsetHeight || this.items().length * 40 + 8;
    const width = panel?.offsetWidth || 170;
    const gap = 4;
    const margin = 8;
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - margin) top = rect.top - height - gap;
    if (top < margin) top = margin;
    let left = rect.right - width;
    if (left < margin) left = margin;
    if (left + width > window.innerWidth - margin) {
      left = window.innerWidth - width - margin;
    }
    if (left < margin) left = margin;
    this.menuStyle.set({ top, left });
  }

  onEscape(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation();
    this.closeMenu();
  }

  onDocumentEscape(): void {
    if (this.open()) this.closeMenu();
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.closeMenu();
  }
}
