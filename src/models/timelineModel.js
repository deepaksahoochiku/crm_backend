const mongoose = require('mongoose');
const { ENTITY_TYPE } = require('../constants/enums');

const timelineSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: [true, 'Action name is required'],
      trim: true
    },
    entityType: {
      type: String,
      required: [true, 'Entity type is required'],
      enum: Object.values(ENTITY_TYPE)
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Entity ID is required'],
      refPath: 'entityType'
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    previousValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    newValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

timelineSchema.index({ entityId: 1, entityType: 1, createdAt: -1 });
timelineSchema.index({ performedBy: 1 });

const Timeline = mongoose.model('Timeline', timelineSchema);

module.exports = Timeline;
