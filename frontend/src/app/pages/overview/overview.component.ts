import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { actionLabel, actionTone, errorMessage, peso } from '../../core/helpers';
import { Overview } from '../../core/models';
import { SystemService } from '../../core/system.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-overview',
  imports: [RouterLink, DatePipe, IconComponent],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.css',
})
export class OverviewComponent {
  private readonly system = inject(SystemService);

  protected readonly data = signal<Overview | null>(null);
  protected readonly error = signal('');

  protected readonly actionLabel = actionLabel;
  protected readonly actionTone = actionTone;
  protected readonly peso = peso;

  constructor() {
    this.system.overview().subscribe({
      next: (overview) => this.data.set(overview),
      error: (error) => this.error.set(errorMessage(error)),
    });
  }
}
