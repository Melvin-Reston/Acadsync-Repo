// A pop-up window. Closes with the × button, the Escape key, or the button
// inside it. Clicking outside (on the backdrop) does NOT close it, so a
// stray click never throws away what the teacher has typed.
//
//   <app-modal title="Add school" (closed)="close()"> ...content... </app-modal>
import { Component, input, output } from '@angular/core';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-modal',
  imports: [IconComponent],
  template: `
    <div class="backdrop"></div>
    <div class="dialog card" role="dialog" aria-modal="true" [attr.aria-label]="title()">
      <header class="dialog-head">
        <h2 class="card-title">{{ title() }}</h2>
        <button type="button" class="icon-btn" aria-label="Close" (click)="closed.emit()">
          <app-icon name="x" />
        </button>
      </header>
      <div class="dialog-body">
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 100;
      display: grid;
      place-items: center;
      padding: 16px;
    }

    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(20, 14, 9, 0.55);
    }

    .dialog {
      position: relative;
      width: 100%;
      max-width: 560px;
      max-height: calc(100dvh - 32px);
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-lg);
    }

    .dialog-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
    }

    .dialog-body {
      padding: 20px;
      overflow-y: auto;
    }
  `,
  host: { '(document:keydown.escape)': 'closed.emit()' },
})
export class ModalComponent {
  readonly title = input.required<string>();
  readonly closed = output<void>();
}
