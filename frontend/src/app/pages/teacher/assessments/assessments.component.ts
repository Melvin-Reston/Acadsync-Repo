// Quizzes & Exams on one page: the sidebar stays short, and the two
// existing pages — online quizzes and the paper exam checker — sit
// behind tabs. Neither page was rewritten: each one runs unchanged
// inside its tab (its own page head hidden, its New button kept), and
// only the open tab is mounted, so switching tabs loads that tab fresh.
// The open tab lives in the address as ?tab=quizzes or ?tab=exams, so
// a refresh, a shared link, or the browser Back button keeps the tab
// the teacher was on. The old /teacher/quizzes and /teacher/exams
// addresses still open the right tab.
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { TeacherExamsComponent } from '../exams/exams.component';
import { TeacherQuizzesComponent } from '../quizzes/quizzes.component';

type AssessmentTab = 'quizzes' | 'exams';

function tabFrom(value: unknown): AssessmentTab | null {
  return value === 'quizzes' || value === 'exams' ? value : null;
}

@Component({
  selector: 'app-teacher-assessments',
  imports: [TeacherQuizzesComponent, TeacherExamsComponent],
  templateUrl: './assessments.component.html',
})
export class TeacherAssessmentsComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly querySubscription: Subscription;

  protected readonly tab = signal<AssessmentTab>('quizzes');

  constructor() {
    this.tab.set(this.resolveTab());
    // A tab change in the address (Back, a shared link, an edited URL)
    // switches the tab without a reload.
    this.querySubscription = this.route.queryParamMap.subscribe(() => {
      this.tab.set(this.resolveTab());
    });
  }

  ngOnDestroy(): void {
    this.querySubscription.unsubscribe();
  }

  // The address wins on the merged page; the old addresses win on
  // their own routes (their route data names the tab); with neither,
  // Quizzes is the first tab.
  private resolveTab(): AssessmentTab {
    return (
      tabFrom(this.route.snapshot.queryParamMap.get('tab')) ??
      tabFrom(this.route.snapshot.data['tab']) ??
      'quizzes'
    );
  }

  protected selectTab(next: AssessmentTab): void {
    if (next === this.tab()) return;
    this.tab.set(next);
    void this.router.navigate(['/teacher/assessments'], { queryParams: { tab: next } });
  }
}
