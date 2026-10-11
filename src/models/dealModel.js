const mongoose = require('mongoose');
const { DEAL_STAGE } = require('../constants/enums');

const dealSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide deal name'],
      trim: true,
      maxlength: [120, 'Deal name cannot exceed 120 characters']
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer reference is required']
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Assigned sales representative is required']
    },
    dealValue: {
      type: Number,
      required: [true, 'Deal value is required'],
      min: [0.01, 'Deal value must be greater than zero']
    },
    probability: {
      type: Number,
      required: [true, 'Probability is required'],
      min: [0, 'Probability cannot be less than 0'],
      max: [100, 'Probability cannot exceed 100'],
      default: 50
    },
    expectedRevenue: {
      type: Number,
      default: 0
    },
    expectedClosingDate: {
      type: Date,
      required: [true, 'Expected closing date is required']
    },
    stage: {
      type: String,
      enum: {
        values: Object.values(DEAL_STAGE),
        message: `{VALUE} is not a valid deal stage. Allowed stages: ${Object.values(DEAL_STAGE).join(', ')}`
      },
      default: DEAL_STAGE.DISCOVERY
    },
    lostReason: {
      type: String,
      trim: true,
      default: ''
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

dealSchema.pre('save', function (next) {
  if (this.dealValue !== undefined && this.probability !== undefined) {
    this.expectedRevenue = Math.round((this.dealValue * this.probability) / 100);
  }
  if (next) next();
});

dealSchema.index({ customer: 1 });
dealSchema.index({ lead: 1 });
dealSchema.index({ assignedTo: 1 });
dealSchema.index({ stage: 1 });
dealSchema.index({ expectedClosingDate: 1 });
dealSchema.index({ createdAt: -1 });

const Deal = mongoose.model('Deal', dealSchema);

module.exports = Deal;
