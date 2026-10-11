const ROLES = Object.freeze({
  ADMIN: 'Admin',
  SALES_MANAGER: 'Sales Manager',
  SALES_EXECUTIVE: 'Sales Executive'
});

const LEAD_STATUS = Object.freeze({
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  UNQUALIFIED: 'Unqualified',
  CONVERTED: 'Converted',
  LOST: 'Lost'
});

const LEAD_SOURCE = Object.freeze({
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  SOCIAL_MEDIA: 'Social Media',
  EMAIL: 'Email',
  PHONE: 'Phone',
  OTHER: 'Other'
});

const PRIORITY = Object.freeze({
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High'
});

const CUSTOMER_STATUS = Object.freeze({
  ACTIVE: 'Active',
  INACTIVE: 'Inactive'
});

const DEAL_STAGE = Object.freeze({
  QUALIFICATION: 'Qualification',
  DISCOVERY: 'Discovery',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost'
});

const ACTIVITY_TYPE = Object.freeze({
  CALL: 'Call',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  DEMO: 'Demo',
  FOLLOW_UP: 'Follow-up',
  REMINDER: 'Reminder',
  NOTE: 'Note'
});

const ACTIVITY_STATUS = Object.freeze({
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  OVERDUE: 'Overdue'
});

const ENTITY_TYPE = Object.freeze({
  LEAD: 'Lead',
  CUSTOMER: 'Customer',
  DEAL: 'Deal',
  ACTIVITY: 'Activity'
});

module.exports = {
  ROLES,
  LEAD_STATUS,
  LEAD_SOURCE,
  PRIORITY,
  CUSTOMER_STATUS,
  DEAL_STAGE,
  ACTIVITY_TYPE,
  ACTIVITY_STATUS,
  ENTITY_TYPE
};
