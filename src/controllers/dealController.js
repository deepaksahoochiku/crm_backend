const mongoose = require('mongoose');
const Deal = require('../models/dealModel');
const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const Timeline = require('../models/timelineModel');
const { ROLES, DEAL_STAGE, ENTITY_TYPE } = require('../constants/enums');

const createDeal = async (req, res, next) => {
  try {
    const {
      name,
      customer: customerId,
      dealValue,
      probability = 50,
      expectedClosingDate,
      stage = DEAL_STAGE.DISCOVERY,
      lostReason,
      description,
      assignedTo
    } = req.body;

    if (!name || !customerId || dealValue === undefined || !expectedClosingDate) {
      return res.status(400).json({
        success: false,
        message: 'name, customer, dealValue, and expectedClosingDate are required fields.'
      });
    }

    const numericDealValue = Number(dealValue);
    if (isNaN(numericDealValue) || numericDealValue <= 0) {
      return res.status(400).json({
        success: false,
        message: 'dealValue must be a positive number greater than zero.'
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
        message: 'Invalid expectedClosingDate format. Please provide a valid date.'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer ID format.'
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found.'
      });
    }

    let dealStage = DEAL_STAGE.DISCOVERY;
    if (stage) {
      const matchedStage = Object.values(DEAL_STAGE).find(
        (s) => s.toLowerCase() === stage.trim().toLowerCase()
      );
      if (!matchedStage) {
        return res.status(400).json({
          success: false,
          message: `Invalid deal stage. Allowed stages: ${Object.values(DEAL_STAGE).join(', ')}`
        });
      }
      dealStage = matchedStage;
    }

    if (dealStage === DEAL_STAGE.LOST && (!lostReason || !lostReason.trim())) {
      return res.status(400).json({
        success: false,
        message: 'lostReason is mandatory when creating a deal in Lost stage.'
      });
    }

    let finalAssignedTo = customer.assignedTo || req.user._id;

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      finalAssignedTo = req.user._id;
    } else if (assignedTo) {
      if (!mongoose.Types.ObjectId.isValid(assignedTo)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid assignedTo user ID format.'
        });
      }

      const targetUser = await User.findOne({ _id: assignedTo, isActive: true });
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'Target assigned user not found or inactive.'
        });
      }

      if (req.user.role === ROLES.SALES_MANAGER) {
        const isTeamMember =
          targetUser.manager && targetUser.manager.toString() === req.user._id.toString();
        const isSelf = targetUser._id.toString() === req.user._id.toString();

        if (!isTeamMember && !isSelf) {
          return res.status(403).json({
            success: false,
            message: 'You can only assign deals to executives in your team.'
          });
        }
      }

      finalAssignedTo = targetUser._id;
    }

    const expectedRevenue = Math.round((numericDealValue * numericProbability) / 100);

    const deal = await Deal.create({
      name: name.trim(),
      customer: customer._id,
      lead: customer.lead || null,
      assignedTo: finalAssignedTo,
      dealValue: numericDealValue,
      probability: numericProbability,
      expectedRevenue,
      expectedClosingDate: closingDate,
      stage: dealStage,
      lostReason: dealStage === DEAL_STAGE.LOST ? lostReason.trim() : '',
      description: (description || '').trim(),
      createdBy: req.user._id
    });

    await Timeline.create({
      action: 'Deal created',
      entityType: ENTITY_TYPE.DEAL,
      entityId: deal._id,
      performedBy: req.user._id,
      newValue: {
        dealName: deal.name,
        dealValue: deal.dealValue,
        stage: deal.stage,
        customer: customer.name
      },
      notes: `Deal '${deal.name}' created with initial value ${deal.dealValue}.`
    });

    if (finalAssignedTo) {
      await Timeline.create({
        action: 'Deal assigned',
        entityType: ENTITY_TYPE.DEAL,
        entityId: deal._id,
        performedBy: req.user._id,
        previousValue: null,
        newValue: finalAssignedTo,
        notes: 'Deal assigned during creation.'
      });
    }

    const populatedDeal = await Deal.findById(deal._id)
      .populate('customer', 'name email company phone')
      .populate('lead', 'name status')
      .populate('assignedTo', 'name email role phone')
      .populate('createdBy', 'name email role');

    res.status(201).json({
      success: true,
      message: 'Deal created successfully.',
      data: {
        deal: populatedDeal
      }
    });
  } catch (error) {
    next(error);
  }
};

const getDeals = async (req, res, next) => {
  try {
    const {
      search,
      keyword,
      q,
      stage,
      customer,
      assignedTo,
      minDealValue,
      maxDealValue,
      startDate,
      endDate,
      fromDate,
      toDate,
      closingStartDate,
      closingEndDate,
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
          { createdBy: req.user._id }
        ];
      }
    } else if (assignedTo) {
      query.assignedTo = assignedTo;
    }

    const searchTerm = (search || keyword || q || '').trim();
    if (searchTerm) {
      const searchRegex = { $regex: searchTerm, $options: 'i' };
      const searchConditions = [{ name: searchRegex }, { description: searchRegex }];

      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchConditions }];
        delete query.$or;
      } else {
        query.$or = searchConditions;
      }
    }

    if (stage) {
      const matchedStage = Object.values(DEAL_STAGE).find(
        (s) => s.toLowerCase() === stage.trim().toLowerCase()
      );
      if (matchedStage) {
        query.stage = matchedStage;
      }
    }

    if (customer && mongoose.Types.ObjectId.isValid(customer)) {
      query.customer = customer;
    }

    if (minDealValue !== undefined || maxDealValue !== undefined) {
      query.dealValue = {};
      if (minDealValue !== undefined && !isNaN(Number(minDealValue))) {
        query.dealValue.$gte = Number(minDealValue);
      }
      if (maxDealValue !== undefined && !isNaN(Number(maxDealValue))) {
        query.dealValue.$lte = Number(maxDealValue);
      }
    }

    const closeStart = closingStartDate;
    const closeEnd = closingEndDate;
    if (closeStart || closeEnd) {
      query.expectedClosingDate = {};
      if (closeStart) query.expectedClosingDate.$gte = new Date(closeStart);
      if (closeEnd) {
        const cEnd = new Date(closeEnd);
        cEnd.setHours(23, 59, 59, 999);
        query.expectedClosingDate.$lte = cEnd;
      }
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

    const [deals, totalDeals] = await Promise.all([
      Deal.find(query)
        .populate('customer', 'name email company phone')
        .populate('lead', 'name status')
        .populate('assignedTo', 'name email role phone')
        .populate('createdBy', 'name email role')
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum),
      Deal.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalDeals / limitNum) || 1;

    res.status(200).json({
      success: true,
      message: 'Deals fetched successfully.',
      data: {
        deals,
        pagination: {
          currentPage: pageNum,
          pageSize: limitNum,
          totalRecords: totalDeals,
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

const getDealById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid deal ID format.'
      });
    }

    const deal = await Deal.findById(id)
      .populate('customer', 'name email company phone address')
      .populate('lead', 'name email company status source')
      .populate('assignedTo', 'name email role phone')
      .populate('createdBy', 'name email role');

    if (!deal) {
      return res.status(404).json({
        success: false,
        message: 'Deal not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      const assignedId = deal.assignedTo ? deal.assignedTo._id.toString() : null;
      if (assignedId !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view deals assigned to you.'
        });
      }
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamExecutiveIds = teamExecutives.map((exec) => exec._id.toString());
      const assignedId = deal.assignedTo ? deal.assignedTo._id.toString() : null;
      const createdById = deal.createdBy ? deal.createdBy._id.toString() : null;

      const isAssignedToTeam = assignedId && teamExecutiveIds.includes(assignedId);
      const isAssignedToSelf = assignedId === req.user._id.toString();
      const isCreatedBySelf = createdById === req.user._id.toString();

      if (!isAssignedToTeam && !isAssignedToSelf && !isCreatedBySelf) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view deals within your team.'
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Deal details retrieved successfully.',
      data: {
        deal
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateDeal = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid deal ID format.'
      });
    }

    const deal = await Deal.findById(id);
    if (!deal) {
      return res.status(404).json({
        success: false,
        message: 'Deal not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      if (deal.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only update deals assigned to you.'
        });
      }
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamExecutiveIds = teamExecutives.map((exec) => exec._id.toString());
      const assignedId = deal.assignedTo.toString();
      const createdById = deal.createdBy.toString();

      const isAssignedToTeam = teamExecutiveIds.includes(assignedId);
      const isAssignedToSelf = assignedId === req.user._id.toString();
      const isCreatedBySelf = createdById === req.user._id.toString();

      if (!isAssignedToTeam && !isAssignedToSelf && !isCreatedBySelf) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only update deals within your team.'
        });
      }
    }

    const isClosed = deal.stage === DEAL_STAGE.WON || deal.stage === DEAL_STAGE.LOST;
    if (isClosed && req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: `Deal is in closed state (${deal.stage}). Only Administrators can modify closed deals.`
      });
    }

    const {
      name,
      dealValue,
      probability,
      expectedClosingDate,
      description,
      customer: customerId,
      assignedTo
    } = req.body;

    const previousData = {
      name: deal.name,
      dealValue: deal.dealValue,
      probability: deal.probability,
      expectedRevenue: deal.expectedRevenue,
      expectedClosingDate: deal.expectedClosingDate,
      description: deal.description,
      assignedTo: deal.assignedTo
    };

    if (name) deal.name = name.trim();
    if (description !== undefined) deal.description = description.trim();

    if (expectedClosingDate) {
      const closingDate = new Date(expectedClosingDate);
      if (isNaN(closingDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid expectedClosingDate format.'
        });
      }
      deal.expectedClosingDate = closingDate;
    }

    if (customerId) {
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid customer ID format.'
        });
      }
      const customerExists = await Customer.findById(customerId);
      if (!customerExists) {
        return res.status(404).json({
          success: false,
          message: 'Target customer not found.'
        });
      }
      deal.customer = customerExists._id;
    }

    if (dealValue !== undefined) {
      const numVal = Number(dealValue);
      if (isNaN(numVal) || numVal <= 0) {
        return res.status(400).json({
          success: false,
          message: 'dealValue must be greater than zero.'
        });
      }
      deal.dealValue = numVal;
    }

    if (probability !== undefined) {
      const numProb = Number(probability);
      if (isNaN(numProb) || numProb < 0 || numProb > 100) {
        return res.status(400).json({
          success: false,
          message: 'probability must be between 0 and 100.'
        });
      }
      deal.probability = numProb;
    }

    deal.expectedRevenue = Math.round((deal.dealValue * deal.probability) / 100);

    if (assignedTo) {
      if (req.user.role === ROLES.SALES_EXECUTIVE) {
        return res.status(403).json({
          success: false,
          message: 'Sales Executives cannot reassign deals.'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(assignedTo)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid assignedTo user ID format.'
        });
      }

      const targetUser = await User.findOne({ _id: assignedTo, isActive: true });
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'Target assigned user not found or inactive.'
        });
      }

      if (req.user.role === ROLES.SALES_MANAGER) {
        const isTeamMember =
          targetUser.manager && targetUser.manager.toString() === req.user._id.toString();
        const isSelf = targetUser._id.toString() === req.user._id.toString();

        if (!isTeamMember && !isSelf) {
          return res.status(403).json({
            success: false,
            message: 'You can only reassign deals to executives in your team.'
          });
        }
      }

      deal.assignedTo = targetUser._id;
    }

    await deal.save();

    await Timeline.create({
      action: 'Deal updated',
      entityType: ENTITY_TYPE.DEAL,
      entityId: deal._id,
      performedBy: req.user._id,
      previousValue: previousData,
      newValue: {
        name: deal.name,
        dealValue: deal.dealValue,
        probability: deal.probability,
        expectedRevenue: deal.expectedRevenue,
        expectedClosingDate: deal.expectedClosingDate,
        assignedTo: deal.assignedTo
      },
      notes: 'Deal attributes updated.'
    });

    if (assignedTo && String(previousData.assignedTo) !== String(deal.assignedTo)) {
      await Timeline.create({
        action: previousData.assignedTo ? 'Deal reassigned' : 'Deal assigned',
        entityType: ENTITY_TYPE.DEAL,
        entityId: deal._id,
        performedBy: req.user._id,
        previousValue: previousData.assignedTo,
        newValue: deal.assignedTo,
        notes: previousData.assignedTo
          ? 'Deal reassigned to new sales executive.'
          : 'Deal assigned to sales executive.'
      });
    }

    const updatedDeal = await Deal.findById(deal._id)
      .populate('customer', 'name email company phone')
      .populate('lead', 'name status')
      .populate('assignedTo', 'name email role phone')
      .populate('createdBy', 'name email role');

    res.status(200).json({
      success: true,
      message: 'Deal updated successfully.',
      data: {
        deal: updatedDeal
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateDealStage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { stage, lostReason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid deal ID format.'
      });
    }

    if (!stage) {
      return res.status(400).json({
        success: false,
        message: 'stage is a required field.'
      });
    }

    const matchedStage = Object.values(DEAL_STAGE).find(
      (s) => s.toLowerCase() === stage.trim().toLowerCase()
    );

    if (!matchedStage) {
      return res.status(400).json({
        success: false,
        message: `Invalid deal stage. Allowed stages: ${Object.values(DEAL_STAGE).join(', ')}`
      });
    }

    const deal = await Deal.findById(id);
    if (!deal) {
      return res.status(404).json({
        success: false,
        message: 'Deal not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      if (deal.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only update stages of your assigned deals.'
        });
      }
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamExecutiveIds = teamExecutives.map((exec) => exec._id.toString());
      const assignedId = deal.assignedTo.toString();
      const createdById = deal.createdBy.toString();

      const isAssignedToTeam = teamExecutiveIds.includes(assignedId);
      const isAssignedToSelf = assignedId === req.user._id.toString();
      const isCreatedBySelf = createdById === req.user._id.toString();

      if (!isAssignedToTeam && !isAssignedToSelf && !isCreatedBySelf) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only update deals within your team.'
        });
      }
    }

    const isCurrentClosed = deal.stage === DEAL_STAGE.WON || deal.stage === DEAL_STAGE.LOST;
    if (isCurrentClosed && req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: `Deal is already closed (${deal.stage}). Only Administrators can reopen or change closed deal stages.`
      });
    }

    if (matchedStage === DEAL_STAGE.LOST && (!lostReason || !lostReason.trim())) {
      return res.status(400).json({
        success: false,
        message: 'lostReason is mandatory when marking a deal as Lost.'
      });
    }

    const previousStage = deal.stage;
    deal.stage = matchedStage;

    if (matchedStage === DEAL_STAGE.WON) {
      deal.probability = 100;
      deal.expectedRevenue = deal.dealValue;
      deal.lostReason = '';
    } else if (matchedStage === DEAL_STAGE.LOST) {
      deal.probability = 0;
      deal.expectedRevenue = 0;
      deal.lostReason = lostReason.trim();
    } else {
      deal.lostReason = '';
    }

    await deal.save();

    await Timeline.create({
      action: 'Deal stage changed',
      entityType: ENTITY_TYPE.DEAL,
      entityId: deal._id,
      performedBy: req.user._id,
      previousValue: previousStage,
      newValue: matchedStage,
      notes:
        matchedStage === DEAL_STAGE.LOST
          ? `Deal marked as Lost. Reason: ${deal.lostReason}`
          : `Deal stage advanced from '${previousStage}' to '${matchedStage}'.`
    });

    if (matchedStage === DEAL_STAGE.WON) {
      await Timeline.create({
        action: 'Deal won',
        entityType: ENTITY_TYPE.DEAL,
        entityId: deal._id,
        performedBy: req.user._id,
        previousValue: previousStage,
        newValue: DEAL_STAGE.WON,
        notes: `Deal successfully closed as Won with value ${deal.dealValue}!`
      });
    } else if (matchedStage === DEAL_STAGE.LOST) {
      await Timeline.create({
        action: 'Deal lost',
        entityType: ENTITY_TYPE.DEAL,
        entityId: deal._id,
        performedBy: req.user._id,
        previousValue: previousStage,
        newValue: DEAL_STAGE.LOST,
        notes: `Deal closed as Lost. Reason: ${deal.lostReason}`
      });
    }

    const updatedDeal = await Deal.findById(deal._id)
      .populate('customer', 'name email company phone')
      .populate('lead', 'name status')
      .populate('assignedTo', 'name email role phone')
      .populate('createdBy', 'name email role');

    res.status(200).json({
      success: true,
      message: `Deal stage updated to '${matchedStage}' successfully.`,
      data: {
        deal: updatedDeal
      }
    });
  } catch (error) {
    next(error);
  }
};

const deleteDeal = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid deal ID format.'
      });
    }

    if (req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. Only Administrators can delete deal records.'
      });
    }

    const deal = await Deal.findById(id);
    if (!deal) {
      return res.status(404).json({
        success: false,
        message: 'Deal not found.'
      });
    }

    await Deal.findByIdAndDelete(id);

    await Timeline.create({
      action: 'Deal Deleted',
      entityType: ENTITY_TYPE.DEAL,
      entityId: id,
      performedBy: req.user._id,
      previousValue: {
        name: deal.name,
        dealValue: deal.dealValue,
        stage: deal.stage
      },
      notes: 'Deal permanently deleted by Administrator.'
    });

    res.status(200).json({
      success: true,
      message: 'Deal deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDeal,
  getDeals,
  getDealById,
  updateDeal,
  updateDealStage,
  deleteDeal
};
