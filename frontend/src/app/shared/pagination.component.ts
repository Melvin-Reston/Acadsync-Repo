// "Showing 1–10 of 42" with Previous / Next buttons.
import { Component, computed, input, output } from '@angular/core';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-pagination',
  imports: [IconComponent],
  template: `
    @if (total() > 0) {
      <div class="pager">
        <span class="mono">{{ first() }}–{{ last() }} of {{ total() }}</span>
        <div class="buttons">
          <button
            type="button"
            class="btn btn-small"
            [disabled]="page() <= 1"
            (click)="pageChange.emit(page() - 1)"
          >
            <app-icon name="chevron-left" [size]="15" /> Previous
          </button>
          <button
            type="button"
            class="btn btn-small"
            [disabled]="page() >= pages()"
            (click)="pageChange.emit(page() + 1)"
          >
            Next <app-icon name="chevron-right" [size]="15" />
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    .pager {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 16px;
      border-top: 1px solid var(--border);
      font-size: 12.5px;
      color: var(--muted);
    }

    .buttons {
      display: flex;
      gap: 8px;
    }
  `,
})
export class PaginationComponent {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  readonly pageChange = output<number>();

  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly first = computed(() => (this.page() - 1) * this.pageSize() + 1);
  protected readonly last = computed(() => Math.min(this.page() * this.pageSize(), this.total()));
}
