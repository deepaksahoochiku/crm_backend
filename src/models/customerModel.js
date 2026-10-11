const mongoose = require('mongoose');
const { CUSTOMER_STATUS } = require('../constants/enums');

const customerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide customer name'],
      trim: true,
      maxlength: [100, 'Customer name cannot exceed 100 characters']
    },
    email: {
      type: String,
      required: [true, 'Please provide customer email'],
      lowercase: true,
      trim: true,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        'Please provide a valid email address'
      ]
    },
    phone: {
      type: String,
      required: [true, 'Please provide customer phone number'],
      trim: true
    },
    company: {
      type: String,
      trim: true,
      default: ''
    },
    address: {
      type: String,
      trim: true,
      default: ''
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Assigned sales executive is required']
    },
    status: {
      type: String,
      enum: {
        values: Object.values(CUSTOMER_STATUS),
        message: `{VALUE} is not a valid customer status. Allowed values: ${Object.values(CUSTOMER_STATUS).join(', ')}`
      },
      default: CUSTOMER_STATUS.ACTIVE
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

customerSchema.index({ email: 1 });
customerSchema.index({ assignedTo: 1 });
customerSchema.index({ lead: 1 });
customerSchema.index({ status: 1 });
customerSchema.index({ createdAt: -1 });

const Customer = mongoose.model('Customer', customerSchema);

module.exports = Customer;
