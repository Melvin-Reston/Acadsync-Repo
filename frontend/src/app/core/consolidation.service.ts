// Academic Consolidation: the adviser's view of every subject grade for
// their advisory section (Batch 4). Read-only for the adviser — the grades
// themselves are filed by each subject teacher from their Grades page.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ConsolidationFinals, ConsolidationView, ManualGradesFileResponse, ManualSubject } from './models';
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

  // ---- Manual subjects (Batch 8 fix 10) ----
  // The adviser creates the subject when its teacher has no AcadSync
  // account, then uploads the term grades as a CSV. Grades are sent as
  // JSON parsed from the file; the backend re-validates every row.

  listManualSubjects(): Observable<{ manual_subjects: ManualSubject[] }> {
    return this.http.get<{ manual_subjects: ManualSubject[] }>(`${this.api}/consolidation/manual-subjects`);
  }

  createManualSubject(
    subjectName: string,
    teacherName: string,
  ): Observable<{ manual_subject: ManualSubject }> {
    return this.http.post<{ manual_subject: ManualSubject }>(`${this.api}/consolidation/manual-subjects`, {
      subject_name: subjectName,
      teacher_name: teacherName,
    });
  }

  updateManualSubject(
    id: number,
    changes: { subject_name?: string; teacher_name?: string },
  ): Observable<{ manual_subject: ManualSubject }> {
    return this.http.patch<{ manual_subject: ManualSubject }>(
      `${this.api}/consolidation/manual-subjects/${id}`,
      changes,
    );
  }

  deleteManualSubject(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/consolidation/manual-subjects/${id}`);
  }

  // The CSV template, prefilled with one row per roster learner.
  downloadManualTemplate(id: number, filename: string): void {
    this.http
      .get(`${this.api}/consolidation/manual-subjects/${id}/template`, { responseType: 'blob' })
      .subscribe({
        next: (blob) => downloadBlob(blob, filename),
      });
  }

  fileManualGrades(
    id: number,
    grades: { learner_id: string; quarter: number; grade: number }[],
  ): Observable<ManualGradesFileResponse> {
    return this.http.post<ManualGradesFileResponse>(
      `${this.api}/consolidation/manual-subjects/${id}/grades`,
      { grades },
    );
  }
}
