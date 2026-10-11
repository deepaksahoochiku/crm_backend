const mongoose = require('mongoose');
const Lead = require('../models/leadModel');
const User = require('../models/userModel');
const Customer = require('../models/customerModel');
const Deal = require('../models/dealModel');
const Timeline = require('../models/timelineModel');
const {
  ROLES,
  LEAD_STATUS,
  LEAD_SOURCE,
  PRIORITY,
  CUSTOMER_STATUS,
  DEAL_STAGE,
  ENTITY_TYPE
} = require('../constants/enums');

const createLead = async (req, res, next) => {
  try {
    const {
      name,
      email,
      phone,
      company,
      source,
      status,
      priority,
      assignedTo,
      description
    } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and phone are required for creating a lead.'
      });
    }

    let finalAssignedTo = null;

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      finalAssignedTo = req.user._id;
    } else if (assignedTo) {
      const executiveUser = await User.findById(assignedTo);
      if (
        !executiveUser ||
        executiveUser.role !== ROLES.SALES_EXECUTIVE ||
        !executiveUser.isActive
      ) {
        return res.status(400).json({
          success: false,
          message: 'Lead can only be assigned to an active Sales Executive.'
        });
      }

      if (
        req.user.role === ROLES.SALES_MANAGER &&
        executiveUser.manager &&
        executiveUser.manager.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only assign leads to Sales Executives in your team.'
        });
      }

      finalAssignedTo = executiveUser._id;
    }

    const lead = await Lead.create({
      name,
      email,
      phone,
      company: company || '',
      source: source || LEAD_SOURCE.WEBSITE,
      status: status || LEAD_STATUS.NEW,
      priority: priority || PRIORITY.MEDIUM,
      assignedTo: finalAssignedTo,
      description: description || '',
      createdBy: req.user._id
    });

    await Timeline.create({
      action: 'Lead created',
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead._id,
      performedBy: req.user._id,
      newValue: {
        name: lead.name,
        email: lead.email,
        status: lead.status,
        priority: lead.priority,
        assignedTo: lead.assignedTo
      },
      notes: `Lead '${lead.name}' created.`
    });

    if (finalAssignedTo) {
      await Timeline.create({
        action: 'Lead assigned',
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead._id,
        performedBy: req.user._id,
        previousValue: null,
        newValue: finalAssignedTo,
        notes: 'Lead assigned during creation.'
      });
    }

    const populatedLead = await Lead.findById(lead._id)
      .populate('assignedTo', 'name email phone role')
      .populate('createdBy', 'name email role');

    res.status(201).json({
      success: true,
      message: 'Lead created successfully',
      data: {
        lead: populatedLead
      }
    });
  } catch (error) {
    next(error);
  }
};

const getLeads = async (req, res, next) => {
  try {
    const {
      search,
      keyword,
      q,
      status,
      priority,
      source,
      assignedTo,
      startDate,
      endDate,
      fromDate,
      toDate,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      sort
    } = req.query;

    const query = {};

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      query.assignedTo = req.user._id;
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamExecutiveIds = teamExecutives.map((exec) => exec._id);

      if (assignedTo) {
        query.assignedTo = assignedTo;
      } else {
        query.$or = [
          { assignedTo: { $in: teamExecutiveIds } },
          { assignedTo: req.user._id },
          { createdBy: req.user._id },
          { assignedTo: null }
        ];
      }
    } else if (assignedTo) {
      query.assignedTo = assignedTo;
    }

    const searchTerm = (search || keyword || q || '').trim();
    if (searchTerm) {
      const searchRegex = { $regex: searchTerm, $options: 'i' };
      const searchConditions = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { company: searchRegex }
      ];

      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchConditions }];
        delete query.$or;
      } else {
        query.$or = searchConditions;
      }
    }

    if (status) {
      const matchedStatus = Object.values(LEAD_STATUS).find(
        (s) => s.toLowerCase() === status.trim().toLowerCase()
      );
      if (matchedStatus) query.status = matchedStatus;
    }

    if (priority) {
      const matchedPriority = Object.values(PRIORITY).find(
        (p) => p.toLowerCase() === priority.trim().toLowerCase()
      );
      if (matchedPriority) query.priority = matchedPriority;
    }

    if (source) {
      const matchedSource = Object.values(LEAD_SOURCE).find(
        (src) => src.toLowerCase() === source.trim().toLowerCase()
      );
      if (matchedSource) query.source = matchedSource;
    }

    const start = startDate || fromDate;
    const end = endDate || toDate;
    if (start || end) {
      query.createdAt = {};
      if (start) query.createdAt.$gte = new Date(start);
      if (end) {
        const endDateTime = new Date(end);
        endDateTime.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDateTime;
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    let sortOption = {};
    if (sort) {
      if (sort.includes(':')) {
        const [field, order] = sort.split(':');
        sortOption[field] = order.toLowerCase() === 'asc' ? 1 : -1;
      } else if (sort.startsWith('-')) {
        sortOption[sort.substring(1)] = -1;
      } else {
        sortOption[sort] = 1;
      }
    } else {
      const direction = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;
      sortOption[sortBy] = direction;
    }

    const [leads, totalLeads] = await Promise.all([
      Lead.find(query)
        .populate('assignedTo', 'name email phone role')
        .populate('createdBy', 'name email role')
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum),
      Lead.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalLeads / limitNum) || 1;

    res.status(200).json({
      success: true,
      message: 'Leads fetched successfully',
      data: {
        leads,
        pagination: {
          currentPage: pageNum,
          pageSize: limitNum,
          totalRecords: totalLeads,
          totalPages,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const getLeadById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const lead = await Lead.findById(id)
      .populate('assignedTo', 'name email phone role')
      .populate('createdBy', 'name email role');

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      if (
        !lead.assignedTo ||
        lead.assignedTo._id.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only view leads assigned to you.'
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Lead fetched successfully',
      data: {
        lead
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      email,
      phone,
      company,
      source,
      status,
      priority,
      assignedTo,
      description
    } = req.body;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      if (
        !lead.assignedTo ||
        lead.assignedTo.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only update leads assigned to you.'
        });
      }

      if (assignedTo !== undefined) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Sales Executives cannot change lead assignments.'
        });
      }
    }

    if (assignedTo !== undefined && req.user.role !== ROLES.SALES_EXECUTIVE) {
      if (assignedTo === null || assignedTo === '') {
        lead.assignedTo = null;
      } else {
        const executiveUser = await User.findById(assignedTo);
        if (
          !executiveUser ||
          executiveUser.role !== ROLES.SALES_EXECUTIVE ||
          !executiveUser.isActive
        ) {
          return res.status(400).json({
            success: false,
            message: 'Lead can only be assigned to an active Sales Executive.'
          });
        }

        if (
          req.user.role === ROLES.SALES_MANAGER &&
          executiveUser.manager &&
          executiveUser.manager.toString() !== req.user._id.toString()
        ) {
          return res.status(403).json({
            success: false,
            message: 'Forbidden: You can only assign leads to Sales Executives in your team.'
          });
        }

        lead.assignedTo = executiveUser._id;
      }
    }

    const prevData = {
      status: lead.status,
      priority: lead.priority,
      assignedTo: lead.assignedTo ? lead.assignedTo.toString() : null
    };

    if (name) lead.name = name;
    if (email) lead.email = email;
    if (phone) lead.phone = phone;
    if (company !== undefined) lead.company = company;
    if (source && Object.values(LEAD_SOURCE).includes(source)) lead.source = source;
    if (status && Object.values(LEAD_STATUS).includes(status)) lead.status = status;
    if (priority && Object.values(PRIORITY).includes(priority)) lead.priority = priority;
    if (description !== undefined) lead.description = description;

    await lead.save();

    if (status && status !== prevData.status) {
      await Timeline.create({
        action: 'Lead status changed',
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead._id,
        performedBy: req.user._id,
        previousValue: prevData.status,
        newValue: lead.status,
        notes: `Lead status changed from '${prevData.status}' to '${lead.status}'.`
      });
    }

    if (priority && priority !== prevData.priority) {
      await Timeline.create({
        action: 'Lead priority changed',
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead._id,
        performedBy: req.user._id,
        previousValue: prevData.priority,
        newValue: lead.priority,
        notes: `Lead priority changed from '${prevData.priority}' to '${lead.priority}'.`
      });
    }

    const currentAssignedStr = lead.assignedTo ? lead.assignedTo.toString() : null;
    if (assignedTo !== undefined && currentAssignedStr !== prevData.assignedTo) {
      await Timeline.create({
        action: prevData.assignedTo ? 'Lead reassigned' : 'Lead assigned',
        entityType: ENTITY_TYPE.LEAD,
        entityId: lead._id,
        performedBy: req.user._id,
        previousValue: prevData.assignedTo,
        newValue: lead.assignedTo,
        notes: prevData.assignedTo
          ? 'Lead reassigned to new sales executive.'
          : 'Lead assigned to sales executive.'
      });
    }

    const updatedLead = await Lead.findById(id)
      .populate('assignedTo', 'name email phone role')
      .populate('createdBy', 'name email role');

    res.status(200).json({
      success: true,
      message: 'Lead updated successfully',
      data: {
        lead: updatedLead
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateLeadStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !Object.values(LEAD_STATUS).includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Valid status is required. Allowed values: ${Object.values(LEAD_STATUS).join(', ')}`
      });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      if (
        !lead.assignedTo ||
        lead.assignedTo.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only update the status of leads assigned to you.'
        });
      }
    }

    const previousStatus = lead.status;
    lead.status = status;
    await lead.save();

    await Timeline.create({
      action: 'Lead status changed',
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead._id,
      performedBy: req.user._id,
      previousValue: previousStatus,
      newValue: status,
      notes: `Lead status changed from '${previousStatus}' to '${status}'.`
    });

    const updatedLead = await Lead.findById(id)
      .populate('assignedTo', 'name email phone role')
      .populate('createdBy', 'name email role');

    res.status(200).json({
      success: true,
      message: `Lead status updated to '${status}' successfully.`,
      data: {
        lead: updatedLead
      }
    });
  } catch (error) {
    next(error);
  }
};

const assignLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assignedTo } = req.body;

    if (!assignedTo) {
      return res.status(400).json({
        success: false,
        message: 'assignedTo (Sales Executive ID) is required.'
      });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.'
      });
    }

    const executiveUser = await User.findById(assignedTo);
    if (
      !executiveUser ||
      executiveUser.role !== ROLES.SALES_EXECUTIVE ||
      !executiveUser.isActive
    ) {
      return res.status(400).json({
        success: false,
        message: 'Lead can only be assigned to an active Sales Executive.'
      });
    }

    if (
      req.user.role === ROLES.SALES_MANAGER &&
      executiveUser.manager &&
      executiveUser.manager.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only assign leads to Sales Executives in your team.'
      });
    }

    const previousAssigned = lead.assignedTo;
    lead.assignedTo = executiveUser._id;
    await lead.save();

    await Timeline.create({
      action: previousAssigned ? 'Lead reassigned' : 'Lead assigned',
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead._id,
      performedBy: req.user._id,
      previousValue: previousAssigned,
      newValue: executiveUser._id,
      notes: previousAssigned
        ? `Lead reassigned to '${executiveUser.name}'.`
        : `Lead assigned to '${executiveUser.name}'.`
    });

    const updatedLead = await Lead.findById(id)
      .populate('assignedTo', 'name email phone role')
      .populate('createdBy', 'name email role');

    res.status(200).json({
      success: true,
      message: `Lead successfully assigned to '${executiveUser.name}'.`,
      data: {
        lead: updatedLead
      }
    });
  } catch (error) {
    next(error);
  }
};

const deleteLead = async (req, res, next) => {
  try {
    const { id } = req.params;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Sales Executives are not permitted to delete leads.'
      });
    }

    await Lead.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: `Lead '${lead.name}' deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
};

const convertLead = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { id } = req.params;
    const {
      dealName,
      dealValue,
      probability = 50,
      expectedClosingDate,
      stage = DEAL_STAGE.DISCOVERY,
      address = '',
      dealDescription = ''
    } = req.body;

    if (!dealName || dealValue === undefined || !expectedClosingDate) {
      return res.status(400).json({
        success: false,
        message: 'dealName, dealValue, and expectedClosingDate are required for lead conversion.'
      });
    }

    const numericDealValue = Number(dealValue);
    if (isNaN(numericDealValue) || numericDealValue <= 0) {
      return res.status(400).json({
        success: false,
        message: 'dealValue must be a positive number greater than 0.'
      });
    }

    const numericProbability = Number(probability);
    if (isNaN(numericProbability) || numericProbability < 0 || numericProbability > 100) {
      return res.status(400).json({
        success: false,
        message: 'probability must be a number between 0 and 100.'
      });
    }

    const closingDate = new Date(expectedClosingDate);
    if (isNaN(closingDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid expectedClosingDate format.'
      });
    }

    if (!Object.values(DEAL_STAGE).includes(stage)) {
      return res.status(400).json({
        success: false,
        message: `Invalid deal stage '${stage}'. Allowed stages: ${Object.values(DEAL_STAGE).join(', ')}`
      });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      if (!lead.assignedTo || lead.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only convert leads assigned to you.'
        });
      }
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamExecutiveIds = teamExecutives.map((exec) => exec._id.toString());
      const isTeamLead =
        (lead.assignedTo && teamExecutiveIds.includes(lead.assignedTo.toString())) ||
        lead.assignedTo?.toString() === req.user._id.toString() ||
        lead.createdBy?.toString() === req.user._id.toString();

      if (!isTeamLead) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only convert leads belonging to your team.'
        });
      }
    }

    if (lead.status === LEAD_STATUS.CONVERTED) {
      return res.status(400).json({
        success: false,
        message: 'This lead has already been converted and cannot be converted again.'
      });
    }

    if (lead.status !== LEAD_STATUS.QUALIFIED) {
      return res.status(400).json({
        success: false,
        message: `Only leads with status 'Qualified' can be converted. Current status is '${lead.status}'.`
      });
    }

    const assignedExecutive = lead.assignedTo || req.user._id;
    let conversionResult = {};

    await session.withTransaction(async () => {
      const [customer] = await Customer.create(
        [
          {
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            company: lead.company,
            address: address || '',
            lead: lead._id,
            assignedTo: assignedExecutive,
            status: CUSTOMER_STATUS.ACTIVE,
            createdBy: req.user._id
          }
        ],
        { session }
      );

      const expectedRevenue = Math.round((numericDealValue * numericProbability) / 100);
      const [deal] = await Deal.create(
        [
          {
            name: dealName.trim(),
            lead: lead._id,
            customer: customer._id,
            assignedTo: assignedExecutive,
            dealValue: numericDealValue,
            probability: numericProbability,
            expectedRevenue,
            expectedClosingDate: closingDate,
            stage,
            description: dealDescription || lead.description || '',
            createdBy: req.user._id
          }
        ],
        { session }
      );

      lead.status = LEAD_STATUS.CONVERTED;
      await lead.save({ session });

      await Timeline.insertMany(
        [
          {
            action: 'Lead Converted',
            entityType: ENTITY_TYPE.LEAD,
            entityId: lead._id,
            performedBy: req.user._id,
            previousValue: LEAD_STATUS.QUALIFIED,
            newValue: LEAD_STATUS.CONVERTED,
            notes: `Converted to Customer '${customer.name}' and Deal '${deal.name}'.`
          },
          {
            action: 'Customer Created',
            entityType: ENTITY_TYPE.CUSTOMER,
            entityId: customer._id,
            performedBy: req.user._id,
            newValue: { customerId: customer._id, name: customer.name },
            notes: `Customer created from Lead conversion (Lead ID: ${lead._id}).`
          },
          {
            action: 'Deal Created',
            entityType: ENTITY_TYPE.DEAL,
            entityId: deal._id,
            performedBy: req.user._id,
            newValue: { dealId: deal._id, dealName: deal.name, value: deal.dealValue },
            notes: `Deal initiated during Lead conversion.`
          }
        ],
        { session }
      );

      conversionResult = { customer, deal, lead };
    });

    session.endSession();

    res.status(201).json({
      success: true,
      message: 'Lead converted successfully into Customer and Deal.',
      data: {
        lead: {
          id: conversionResult.lead._id,
          name: conversionResult.lead.name,
          email: conversionResult.lead.email,
          status: conversionResult.lead.status
        },
        customer: conversionResult.customer,
        deal: conversionResult.deal
      }
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    next(error);
  }
};

module.exports = {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  updateLeadStatus,
  assignLead,
  deleteLead,
  convertLead
};
