// Academic Consolidation: the adviser's view of every subject grade for
// their advisory section (Batch 4). Read-only for the adviser — the grades
// themselves are filed by each subject teacher from their Grades page.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ConsolidationFinals, ConsolidationView } from './models';
import { downloadBlob, toParams } from './helpers';

@Injectable({ providedIn: 'root' })
export class ConsolidationService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/teacher`;

  // The consolidated sheet for the teacher's advisory section and period.
  // No period means the highest period that already has data, else the first period.
  view(quarter?: number): Observable<ConsolidationView> {
    return this.http.get<ConsolidationView>(`${this.api}/consolidation`, {
      params: toParams({ quarter }),
    });
  }

  // The final grades across the year's periods: each subject's final grade
  // is the mean of its period grades, and the final GWA is the mean of the
  // final grades.
  finals(): Observable<ConsolidationFinals & { scope: string }> {
    return this.http.get<ConsolidationFinals & { scope: string }>(`${this.api}/consolidation`, {
      params: toParams({ scope: 'final' }),
    });
  }

  // Asks one subject teacher to file their grades for the quarter.
  remind(classId: number, quarter: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.api}/consolidation/remind`, {
      class_id: classId,
      quarter,
    });
  }

  // Downloads the consolidated sheet as a CSV file.
  exportCsv(quarter: number, filename: string): void {
    this.http
      .get(`${this.api}/consolidation`, {
        params: toParams({ quarter, format: 'csv' }),
        responseType: 'blob',
      })
      .subscribe({
        next: (blob) => downloadBlob(blob, filename),
      });
  }

  // Downloads the final grades across the year's periods as a CSV file.
  exportFinalsCsv(filename: string): void {
    this.http
      .get(`${this.api}/consolidation`, {
        params: toParams({ scope: 'final', format: 'csv' }),
        responseType: 'blob',
      })
      .subscribe({
        next: (blob) => downloadBlob(blob, filename),
      });
  }
}
