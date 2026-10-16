-- A buyer team's onboarding answers get their own collection kind, so a
-- saved search can never be mistaken for them by name. They are the rows
-- named "Preferences" whose query has the answers' shape (a domains list).
UPDATE `collections` SET `kind` = 'preferences'
WHERE `kind` = 'query' AND `name` = 'Preferences' AND json_extract(`query`, '$.domains') IS NOT NULL;
