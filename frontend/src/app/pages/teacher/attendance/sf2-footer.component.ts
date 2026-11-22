// The last part of School Form 2: the Guidelines, the attendance codes, the
// reasons/causes list, the month summary table and the certification. The
// same markup renders below the table in the SF2 preview and in the
// printout, so what the teacher sees is what prints. The static wording is
// the DepEd form's own text. Figures the system cannot know (enrolment as
// of the 1st Friday, late enrolment, dropped out, transferred) stay blank
// for handwriting and are never invented.
import { Component, input } from '@angular/core';
import { Sf2Report } from '../../../core/models';

@Component({
  selector: 'app-sf2-footer',
  templateUrl: './sf2-footer.component.html',
  styleUrl: './sf2-footer.component.css',
})
export class Sf2FooterComponent {
  readonly report = input.required<Sf2Report>();

  // One decimal, as the summary table shows it; blank when there is
  // nothing to divide by.
  protected oneDecimal(value: number | null): string {
    if (value === null || value === undefined) return '';
    return value.toFixed(1);
  }
}
