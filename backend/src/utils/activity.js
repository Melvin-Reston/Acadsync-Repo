// Writes one line to the activity log: who did what, and when.
const db = require('../db');

const ROLE_LABELS = { super_user: 'Super User', admin: 'Admin' };

async function logActivity(req, { action, entityType = null, entityId = null, description, actor = null }, client = db) {
  const admin = actor || req.admin;
  await client.query(
    `INSERT INTO activity_log (admin_id, admin_name, admin_role, action, entity_type, entity_id, description, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [admin.id, admin.full_name, admin.role, action, entityType, entityId, description, req.ip || null]
  );
}

// For things the system does by itself, such as ending a subscription when its time is up.
async function logSystemActivity({ action, entityType = null, entityId = null, description }, client = db) {
  await client.query(
    `INSERT INTO activity_log (admin_id, admin_name, admin_role, action, entity_type, entity_id, description)
     VALUES (NULL, 'System', 'system', $1, $2, $3, $4)`,
    [action, entityType, entityId, description]
  );
}

module.exports = { logActivity, logSystemActivity, ROLE_LABELS };
