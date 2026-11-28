// Report Card (DepEd School Form 9): the adviser's section, one card per
// learner. The card is filled from the consolidated grades and the attendance
// records; the teacher's comment per learner per period is the only thing
// typed on the card, and the only thing saved from this page.
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ReportCardView } from './models';

@Injectable({ providedIn: 'root' })
export class ReportCardService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/teacher`;

  // The cards for the teacher's advisory section: every learner, in roster order.
  view(academicYear?: string): Observable<ReportCardView> {
    return this.http.get<ReportCardView>(`${this.api}/report-card`, {
      params: academicYear ? { academic_year: academicYear } : {},
    });
  }

  // The school's seal image itself (fetched with the teacher token, not
  // by a plain link), printed on the right side of the card front.
  schoolSeal(): Observable<Blob> {
    return this.http.get(`${this.api}/school/seal`, { responseType: 'blob' });
  }

  // The DepEd seal image itself, read from the database so an admin
  // replacement is what prints, on the left side of the card front.
  depedSeal(): Observable<Blob> {
    return this.http.get(`${this.api}/deped/seal`, { responseType: 'blob' });
  }

  // Saves one comment. A blank comment clears the saved one.
  saveComment(
    learnerId: string,
    period: number,
    comment: string,
    academicYear?: string,
  ): Observable<{ message: string; learner_id: string; period: number; comment: string | null }> {
    return this.http.put<{ message: string; learner_id: string; period: number; comment: string | null }>(
      `${this.api}/report-card/comments`,
      { learner_id: learnerId, period, comment, academic_year: academicYear ?? '' },
    );
  }
}
