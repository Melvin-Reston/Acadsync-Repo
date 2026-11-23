// The school year a teacher is viewing (Batch 8 fix 13): the AY filter in
// the top bar. It is view-only — it never changes the admin's current year
// in Settings, and it never changes which year a new class is filed under.
// Pages read selectedYear() and reload their records for that year; a year
// with no records shows the empty state, never another year's records.
// The choice is kept in this browser only, and only while it is still one
// of the years the teacher has records in.
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';

const STORAGE_KEY = 'acadsync.viewingYear.v1';

@Injectable({ providedIn: 'root' })
export class ViewingYearService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/teacher`;

  // The admin's current year. New classes still default to this year.
  readonly currentYear = signal<string | null>(null);
  // Every year the teacher can view, newest first.
  readonly years = signal<string[]>([]);
  // The year being viewed. Null until the years have loaded.
  readonly selectedYear = signal<string | null>(null);
  readonly loaded = signal(false);

  readonly isViewingPastYear = computed(() => {
    const selected = this.selectedYear();
    const current = this.currentYear();
    return selected !== null && current !== null && selected !== current;
  });

  // The years the teacher has records in, with the current year first in
  // the list when it is the only one. Called once, by the teacher layout.
  load(): void {
    if (this.loaded()) return;
    this.http
      .get<{ current_academic_year: string | null; academic_years: string[] }>(
        `${this.api}/academic-years`,
      )
      .subscribe({
        next: (response) => {
          this.currentYear.set(response.current_academic_year);
          this.years.set(response.academic_years);
          const stored = window.localStorage.getItem(STORAGE_KEY);
          const selected =
            stored && response.academic_years.includes(stored)
              ? stored
              : (response.current_academic_year ?? response.academic_years[0] ?? null);
          this.selectedYear.set(selected);
          this.loaded.set(true);
        },
        error: () => {
          // The filter stays hidden when the years cannot be read; every
          // page still loads its records for the current year.
          this.loaded.set(true);
        },
      });
  }

  select(year: string): void {
    if (!this.years().includes(year)) return;
    this.selectedYear.set(year);
    window.localStorage.setItem(STORAGE_KEY, year);
  }

  // For tests and for a fresh sign-in: forget the stored choice.
  reset(): void {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
