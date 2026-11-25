// One printed answer sheet: strictly black and white, plain white
// paper, in any mode. The four black corner squares are what the photo
// checker looks for, and the circles sit exactly where the checker
// expects them: both come from the same layout in core/omr.ts, so the
// printer and the reader can never drift apart. Every row lines up on
// the same five circle positions; a question with fewer choices
// simply has fewer circles, and a True/False row gets a small T and F
// above its two circles so the learner is never guessing which is
// which.
//
// The sheet is for ONE learner: their name and Learner ID are printed
// on it, so the checker never has to read a bubbled ID or handwriting
// to know whose sheet it is. Print at 100% size, one sheet per page.
import { Component, computed, input } from '@angular/core';
import { CHOICE_LETTERS, OMR_GRID_CHOICES, OMR_HEIGHT, OMR_WIDTH, bubbleCenter, questionLabels, sheetLayout } from '../../../core/omr';
import { Exam, ExamQuestion } from '../../../core/models';

export interface SheetLearner {
  first_name: string;
  last_name: string;
  learner_id: string;
}

const DEFAULT_QUESTION: ExamQuestion = { choices: 4, correct: null, kind: 'mcq' };

@Component({
  selector: 'app-exam-sheet',
  templateUrl: './exam-sheet.component.html',
  styleUrl: './exam-sheet.component.css',
})
export class ExamSheetComponent {
  readonly exam = input.required<Exam>();
  readonly learner = input.required<SheetLearner>();

  // One entry per question, in order. An exam whose key has not been
  // entered yet prints the default 4-choice row for every question.
  protected readonly questions = computed<ExamQuestion[]>(() => {
    const exam = this.exam();
    return Array.from({ length: exam.question_count }, (_, index) => exam.questions[index] ?? DEFAULT_QUESTION);
  });

  protected readonly layout = computed(() => sheetLayout(this.exam().question_count, this.questions()));

  // The question number sits just left of its first circle, in the same
  // row, in both columns.
  protected readonly numbers = computed(() => {
    const layout = this.layout();
    const byQuestion = new Map<number, { left: number; top: number }>();
    for (const bubble of layout.bubbles) {
      if (!byQuestion.has(bubble.question)) byQuestion.set(bubble.question, { left: bubble.left, top: bubble.top });
    }
    return Array.from(byQuestion.entries()).map(([question, position]) => ({
      question,
      left: position.left - 4.2,
      top: position.top,
    }));
  });

  // The choice letters sit above the first row of each column, on the
  // shared grid positions, so they line up with every row below.
  protected readonly columnLabels = computed(() => {
    const exam = this.exam();
    const rows = Math.ceil(exam.question_count / 2);
    const out: { label: string; left: number; top: number }[] = [];
    for (let choice = 0; choice < OMR_GRID_CHOICES; choice += 1) {
      const leftCentre = bubbleCenter(0, choice, exam.question_count);
      const rightCentre = bubbleCenter(rows, choice, exam.question_count);
      out.push({
        label: CHOICE_LETTERS[choice],
        left: (leftCentre.x / OMR_WIDTH) * 100,
        top: (leftCentre.y / OMR_HEIGHT) * 100 - 2.6,
      });
      out.push({
        label: CHOICE_LETTERS[choice],
        left: (rightCentre.x / OMR_WIDTH) * 100,
        top: (rightCentre.y / OMR_HEIGHT) * 100 - 2.6,
      });
    }
    return out;
  });

  // A small T or F above each circle of a True/False row. Letter rows
  // need none: the column letters above the grid already name them.
  protected readonly bubbleLabels = computed(() => {
    const layout = this.layout();
    const questions = this.questions();
    const out: { label: string; left: number; top: number }[] = [];
    for (const bubble of layout.bubbles) {
      const question = questions[bubble.question];
      if (question.kind !== 'true_false') continue;
      out.push({
        label: questionLabels(question)[bubble.choice],
        left: bubble.left,
        top: bubble.top - 2.0,
      });
    }
    return out;
  });

  protected readonly choiceLetters = CHOICE_LETTERS;
}
