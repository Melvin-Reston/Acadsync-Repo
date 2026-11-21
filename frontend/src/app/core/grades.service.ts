// Grades: the teacher's own class records (Batch 4).
// Everything here is scoped to the signed-in teacher on the server —
// a teacher can only encode grades for their own classes.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  GradeColumn,
  GradeSheet,
  GradeWeights,
  SubmissionCheck,
} from './models';
import { downloadBlob, toParams } from './helpers';

export interface ScoreCell {
  column_id: number;
  learner_id: number;
  score: number | null; // null clears the cell
}

@Injectable({ providedIn: 'root' })
export class GradesService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/teacher`;

  // The grade sheet for one class and quarter: columns, scores, computed
  // grades, summary stats, submission state and any adviser reminder.
  // No quarter means the highest quarter that already has data, else Quarter 1.
  sheet(classId: number, quarter?: number): Observable<GradeSheet> {
    return this.http.get<GradeSheet>(`${this.api}/grades/${classId}`, {
      params: toParams({ quarter }),
    });
  }

  // Saves the given score cells (blank cells arrive as null).
  saveScores(
    classId: number,
    quarter: number,
    scores: ScoreCell[],
  ): Observable<{ message: string; saved: number; submission_cleared: boolean }> {
    return this.http.post<{ message: string; saved: number; submission_cleared: boolean }>(
      `${this.api}/grades/${classId}/scores`,
      { quarter, scores },
    );
  }

  // Adds the next column for a component (WW5 after WW4, and so on).
  addColumn(classId: number, quarter: number, component: 'WW' | 'PT' | 'EX'): Observable<{ message: string; column: GradeColumn }> {
    return this.http.post<{ message: string; column: GradeColumn }>(`${this.api}/grades/${classId}/columns`, {
      quarter,
      component,
    });
  }

  // Changes a column's highest possible score.
  updateColumn(classId: number, columnId: number, highestPossible: number): Observable<{ message: string; column: GradeColumn }> {
    return this.http.patch<{ message: string; column: GradeColumn }>(
      `${this.api}/grades/${classId}/columns/${columnId}`,
      { highest_possible: highestPossible },
    );
  }

  // Saves the Examinations sub-weights for one period together (ST1 30,
  // ST2 30, Term Exam 40). They must add up to 100.
  updateSubWeights(
    classId: number,
    quarter: number,
    subWeights: { column_id: number; sub_weight: number }[],
  ): Observable<{ message: string; columns: GradeColumn[] }> {
    return this.http.patch<{ message: string; columns: GradeColumn[] }>(
      `${this.api}/grades/${classId}/sub-weights`,
      { quarter, sub_weights: subWeights },
    );
  }

  // Removes a column and the scores in it. The last column of a component stays.
  deleteColumn(classId: number, columnId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/grades/${classId}/columns/${columnId}`);
  }

  // Replaces the three weights; they must add up to 100.
  updateWeights(classId: number, weights: GradeWeights): Observable<{ message: string; weights: GradeWeights }> {
    return this.http.patch<{ message: string; weights: GradeWeights }>(`${this.api}/grades/${classId}/weights`, {
      ww_weight: weights.ww,
      pt_weight: weights.pt,
      ex_weight: weights.ex,
    });
  }

  // The submit checklist: how many learners are complete, who is not.
  submissionCheck(classId: number, quarter: number): Observable<SubmissionCheck> {
    return this.http.get<SubmissionCheck>(`${this.api}/grades/${classId}/submission-check`, {
      params: toParams({ quarter }),
    });
  }

  // Files the quarter's grades with the adviser. When some records are
  // incomplete, confirm_blanks must be true.
  submit(
    classId: number,
    quarter: number,
    confirmBlanks: boolean,
  ): Observable<{ message: string; direct: boolean; submission: { class_id: number; quarter: number; academic_year: string; submitted_at: string } }> {
    return this.http.post<{
      message: string;
      direct: boolean;
      submission: { class_id: number; quarter: number; academic_year: string; submitted_at: string };
    }>(`${this.api}/grades/${classId}/submit`, { quarter, confirm_blanks: confirmBlanks });
  }

  // Downloads the class/quarter grade sheet as a CSV file.
  exportCsv(classId: number, quarter: number, filename: string): void {
    this.http
      .get(`${this.api}/grades/${classId}`, {
        params: toParams({ quarter, format: 'csv' }),
        responseType: 'blob',
      })
      .subscribe({
        next: (blob) => downloadBlob(blob, filename),
      });
  }
}
