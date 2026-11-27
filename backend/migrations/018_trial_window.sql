-- One free window per teacher: 30 days from the teacher's first subscription.
-- Teacher Free and the Teacher Pro trial are the same window, not two:
-- switching plans never pauses, extends or restarts it, and Teacher Free
-- can only ever be the teacher's first subscription (enforced in billing.js).
ALTER TABLE teachers ADD COLUMN trial_ends_at TIMESTAMPTZ;

-- Existing teachers keep the window they already started: 30 days from
-- their earliest subscription. Teachers with no subscription get no
-- window until their first one is created.
UPDATE teachers t
   SET trial_ends_at = (
     SELECT MIN(s.started_at) + INTERVAL '30 days'
       FROM subscriptions s
      WHERE s.teacher_id = t.id
   )
 WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.teacher_id = t.id);
