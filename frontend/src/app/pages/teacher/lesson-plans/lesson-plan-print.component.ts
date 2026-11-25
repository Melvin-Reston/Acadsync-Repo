// The printed lesson plan (Batch 11): the ILAW document itself, in the
// DepEd layout from the sample plan — black and white, plain white
// paper, in any mode. It takes the same detail read the editor uses,
// so the paper and the screen can never show different words. Empty
// sections print as —, never as invented content.
import { Component, input } from '@angular/core';
import { LessonPlanDetail } from '../../../core/models';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

@Component({
  selector: 'app-lesson-plan-print',
  templateUrl: './lesson-plan-print.component.html',
  styleUrl: './lesson-plan-print.component.css',
})
export class LessonPlanPrintComponent {
  readonly detail = input.required<LessonPlanDetail>();

  protected plan() {
    return this.detail().plan;
  }

  protected header() {
    return this.detail().header;
  }

  // A YYYY-MM-DD date as "August 20, 2026", worked out from the parts
  // so the timezone can never move it a day.
  protected formatDate(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return iso;
    return `${MONTHS[month - 1]} ${day}, ${year}`;
  }

  protected hasText(value: string | null | undefined): boolean {
    return String(value ?? '').trim().length > 0;
  }

  protected checkedBy(): string | null {
    return this.plan().checked_by_name?.trim() || this.header().school_head_name;
  }

  protected objectives(): { label: string; text: string }[] {
    const plan = this.plan();
    return [
      { label: 'Knowledge', text: plan.objective_knowledge },
      { label: 'Skill', text: plan.objective_skill },
      { label: 'Attitude', text: plan.objective_attitude },
      { label: 'Values', text: plan.objective_values },
    ].filter((entry) => this.hasText(entry.text));
  }
}
