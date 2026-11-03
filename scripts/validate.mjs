const STATUSES = new Set([
  "offer",
  "accepted",
  "applied",
  "visited",
  "interested",
  "backup",
  "pending",
  "closed"
]);

const CHANNELS = new Set(["email", "text", "call", "in-person", "X DM", "other"]);
const DIRECTIONS = new Set(["in", "out"]);
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, path, errors) {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  const present = Object.keys(value);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} is required`);
  }
  for (const key of present) {
    if (!keys.includes(key)) errors.push(`${path}.${key} is not a known field`);
  }
  return true;
}

function requireString(value, path, errors, { allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    errors.push(`${path} must be a string`);
    return false;
  }
  if (!allowEmpty && value.trim() === "") errors.push(`${path} cannot be empty`);
  return typeof value === "string";
}

function requireDate(value, path, errors, { allowEmpty = false } = {}) {
  if (!requireString(value, path, errors, { allowEmpty: true })) return;
  if (value === "") {
    if (!allowEmpty) errors.push(`${path} must be a YYYY-MM-DD date`);
    return;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    errors.push(`${path} must be a YYYY-MM-DD date`);
    return;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    errors.push(`${path} is not a real calendar date`);
  }
}

function requireStringArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((item, index) => requireString(item, `${path}[${index}]`, errors));
}

export function validateTracker(data) {
  const errors = [];
  if (!exactKeys(data, ["profile", "lastUpdated", "upcoming", "schools"], "tracker", errors)) return errors;

  if (exactKeys(data.profile, ["name", "classYear", "gpa", "notes"], "profile", errors)) {
    requireString(data.profile.name, "profile.name", errors);
    if (!Number.isInteger(data.profile.classYear) || data.profile.classYear < 2000 || data.profile.classYear > 2100) {
      errors.push("profile.classYear must be a four-digit class year");
    }
    if (typeof data.profile.gpa !== "number" || !Number.isFinite(data.profile.gpa) || data.profile.gpa < 0 || data.profile.gpa > 10) {
      errors.push("profile.gpa must be a number from 0 through 10");
    }
    requireString(data.profile.notes, "profile.notes", errors, { allowEmpty: true });
  }

  requireDate(data.lastUpdated, "lastUpdated", errors);

  if (!Array.isArray(data.upcoming)) errors.push("upcoming must be an array");
  else {
    data.upcoming.forEach((item, index) => {
      const path = `upcoming[${index}]`;
      if (!exactKeys(item, ["date", "title", "school"], path, errors)) return;
      requireDate(item.date, `${path}.date`, errors);
      requireString(item.title, `${path}.title`, errors);
      requireString(item.school, `${path}.school`, errors);
    });
  }

  if (!Array.isArray(data.schools)) errors.push("schools must be an array");
  else {
    const ids = new Set();
    data.schools.forEach((school, index) => {
      const path = `schools[${index}]`;
      if (!exactKeys(school, [
        "id",
        "name",
        "location",
        "level",
        "sports",
        "status",
        "priority",
        "offers",
        "application",
        "visits",
        "scholarships",
        "contacts",
        "engineeringNotes",
        "nextSteps",
        "comms"
      ], path, errors)) return;

      if (requireString(school.id, `${path}.id`, errors) && !ID_RE.test(school.id)) {
        errors.push(`${path}.id must be a lowercase slug`);
      } else if (ids.has(school.id)) errors.push(`${path}.id is duplicated`);
      ids.add(school.id);

      requireString(school.name, `${path}.name`, errors);
      requireString(school.location, `${path}.location`, errors);
      requireString(school.level, `${path}.level`, errors);
      requireStringArray(school.sports, `${path}.sports`, errors);
      if (typeof school.status !== "string" || !STATUSES.has(school.status)) {
        errors.push(`${path}.status must be one of ${[...STATUSES].join(", ")}`);
      }
      if (!Number.isInteger(school.priority) || school.priority < 1) {
        errors.push(`${path}.priority must be an integer of 1 or greater (1 is the top priority)`);
      }
      requireString(school.engineeringNotes, `${path}.engineeringNotes`, errors, { allowEmpty: true });

      if (!Array.isArray(school.offers)) errors.push(`${path}.offers must be an array`);
      else {
        school.offers.forEach((offer, offerIndex) => {
          const offerPath = `${path}.offers[${offerIndex}]`;
          if (!exactKeys(offer, ["sport", "type", "amount", "date", "notes"], offerPath, errors)) return;
          requireString(offer.sport, `${offerPath}.sport`, errors);
          requireString(offer.type, `${offerPath}.type`, errors);
          requireString(offer.amount, `${offerPath}.amount`, errors, { allowEmpty: true });
          requireDate(offer.date, `${offerPath}.date`, errors, { allowEmpty: true });
          requireString(offer.notes, `${offerPath}.notes`, errors, { allowEmpty: true });
        });
      }

      const appPath = `${path}.application`;
      if (exactKeys(school.application, ["status", "submitted", "decision", "decisionDate"], appPath, errors)) {
        requireString(school.application.status, `${appPath}.status`, errors, { allowEmpty: true });
        requireDate(school.application.submitted, `${appPath}.submitted`, errors, { allowEmpty: true });
        requireString(school.application.decision, `${appPath}.decision`, errors, { allowEmpty: true });
        requireDate(school.application.decisionDate, `${appPath}.decisionDate`, errors, { allowEmpty: true });
      }

      if (!Array.isArray(school.visits)) errors.push(`${path}.visits must be an array`);
      else {
        school.visits.forEach((visit, visitIndex) => {
          const visitPath = `${path}.visits[${visitIndex}]`;
          if (!exactKeys(visit, ["date", "type", "notes"], visitPath, errors)) return;
          requireDate(visit.date, `${visitPath}.date`, errors, { allowEmpty: true });
          requireString(visit.type, `${visitPath}.type`, errors);
          requireString(visit.notes, `${visitPath}.notes`, errors, { allowEmpty: true });
        });
      }

      if (!Array.isArray(school.scholarships)) errors.push(`${path}.scholarships must be an array`);
      else {
        school.scholarships.forEach((scholarship, scholarshipIndex) => {
          const scholarshipPath = `${path}.scholarships[${scholarshipIndex}]`;
          if (!exactKeys(scholarship, ["name", "status", "notes"], scholarshipPath, errors)) return;
          requireString(scholarship.name, `${scholarshipPath}.name`, errors);
          requireString(scholarship.status, `${scholarshipPath}.status`, errors);
          requireString(scholarship.notes, `${scholarshipPath}.notes`, errors, { allowEmpty: true });
        });
      }

      if (!Array.isArray(school.contacts)) errors.push(`${path}.contacts must be an array`);
      else {
        school.contacts.forEach((contact, contactIndex) => {
          const contactPath = `${path}.contacts[${contactIndex}]`;
          if (!exactKeys(contact, ["name", "role", "sport", "email", "phone"], contactPath, errors)) return;
          requireString(contact.name, `${contactPath}.name`, errors);
          requireString(contact.role, `${contactPath}.role`, errors, { allowEmpty: true });
          requireString(contact.sport, `${contactPath}.sport`, errors, { allowEmpty: true });
          requireString(contact.email, `${contactPath}.email`, errors, { allowEmpty: true });
          requireString(contact.phone, `${contactPath}.phone`, errors, { allowEmpty: true });
        });
      }

      if (!Array.isArray(school.nextSteps)) errors.push(`${path}.nextSteps must be an array`);
      else {
        school.nextSteps.forEach((step, stepIndex) => {
          const stepPath = `${path}.nextSteps[${stepIndex}]`;
          if (!exactKeys(step, ["date", "text"], stepPath, errors)) return;
          requireDate(step.date, `${stepPath}.date`, errors, { allowEmpty: true });
          requireString(step.text, `${stepPath}.text`, errors);
        });
      }

      if (!Array.isArray(school.comms)) errors.push(`${path}.comms must be an array`);
      else {
        school.comms.forEach((comm, commIndex) => {
          const commPath = `${path}.comms[${commIndex}]`;
          if (!exactKeys(comm, ["date", "channel", "direction", "with", "summary"], commPath, errors)) return;
          requireDate(comm.date, `${commPath}.date`, errors);
          if (typeof comm.channel !== "string" || !CHANNELS.has(comm.channel)) {
            errors.push(`${commPath}.channel must be one of ${[...CHANNELS].join(", ")}`);
          }
          if (typeof comm.direction !== "string" || !DIRECTIONS.has(comm.direction)) {
            errors.push(`${commPath}.direction must be in or out`);
          }
          requireString(comm.with, `${commPath}.with`, errors);
          requireString(comm.summary, `${commPath}.summary`, errors);
        });
      }
    });
  }

  return errors;
}
