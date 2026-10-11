const mongoose = require('mongoose');
const { LEAD_STATUS, LEAD_SOURCE, PRIORITY } = require('../constants/enums');

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a lead name'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    email: {
      type: String,
      required: [true, 'Please provide a lead email address'],
      lowercase: true,
      trim: true,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        'Please provide a valid email address'
      ]
    },
    phone: {
      type: String,
      required: [true, 'Please provide a lead phone number'],
      trim: true
    },
    company: {
      type: String,
      trim: true,
      default: ''
    },
    source: {
      type: String,
      enum: {
        values: Object.values(LEAD_SOURCE),
        message: `{VALUE} is not a valid lead source. Allowed sources: ${Object.values(LEAD_SOURCE).join(', ')}`
      },
      default: LEAD_SOURCE.WEBSITE
    },
    status: {
      type: String,
      enum: {
        values: Object.values(LEAD_STATUS),
        message: `{VALUE} is not a valid lead status. Allowed statuses: ${Object.values(LEAD_STATUS).join(', ')}`
      },
      default: LEAD_STATUS.NEW
    },
    priority: {
      type: String,
      enum: {
        values: Object.values(PRIORITY),
        message: `{VALUE} is not a valid priority. Allowed priorities: ${Object.values(PRIORITY).join(', ')}`
      },
      default: PRIORITY.MEDIUM
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    timestamps: true
  }
);

leadSchema.index({ status: 1 });
leadSchema.index({ priority: 1 });
leadSchema.index({ source: 1 });
leadSchema.index({ assignedTo: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ name: 1, email: 1 });

const Lead = mongoose.model('Lead', leadSchema);

module.exports = Lead;
