const mongoose = require('mongoose');
const { ACTIVITY_TYPE, ACTIVITY_STATUS } = require('../constants/enums');

const activitySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Activity title/subject is required'],
      trim: true,
      maxlength: [150, 'Title cannot exceed 150 characters']
    },
    type: {
      type: String,
      required: [true, 'Activity type is required'],
      enum: {
        values: Object.values(ACTIVITY_TYPE),
        message: `{VALUE} is not a valid activity type. Allowed: ${Object.values(ACTIVITY_TYPE).join(', ')}`
      }
    },
    status: {
      type: String,
      enum: {
        values: Object.values(ACTIVITY_STATUS),
        message: `{VALUE} is not a valid activity status. Allowed: ${Object.values(ACTIVITY_STATUS).join(', ')}`
      },
      default: ACTIVITY_STATUS.PENDING
    },
    dueDate: {
      type: Date,
      required: function () {
        return this.type !== ACTIVITY_TYPE.NOTE;
      }
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null
    },
    deal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Deal',
      default: null
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Assigned user is required']
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    completedAt: {
      type: Date,
      default: null
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

activitySchema.index({ assignedTo: 1, status: 1 });
activitySchema.index({ dueDate: 1 });
activitySchema.index({ lead: 1 });
activitySchema.index({ customer: 1 });
activitySchema.index({ deal: 1 });

const Activity = mongoose.model('Activity', activitySchema);

module.exports = Activity;
