const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const { ROLES } = require('../constants/enums');

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized. No authentication token provided.'
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'crm_jwt_secret_key_super_secure_random_string_2026'
    );

    const currentUser = await User.findById(decoded.id).select('-password');
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'The user belonging to this token no longer exists.'
      });
    }

    if (!currentUser.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact an administrator.'
      });
    }

    req.user = currentUser;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized. Invalid or expired token.'
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Role '${req.user ? req.user.role : 'Guest'}' is not authorized to access this resource.`
      });
    }
    next();
  };
};

const accessByAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Access restricted to Admin only.'
    });
  }
  next();
};

const accessByManager = (req, res, next) => {
  if (!req.user || req.user.role !== ROLES.SALES_MANAGER) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Access restricted to Sales Manager only.'
    });
  }
  next();
};

const accessByExecutive = (req, res, next) => {
  if (!req.user || req.user.role !== ROLES.SALES_EXECUTIVE) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Access restricted to Sales Executive only.'
    });
  }
  next();
};

const accessByAdminOrManager = (req, res, next) => {
  if (
    !req.user ||
    (req.user.role !== ROLES.ADMIN && req.user.role !== ROLES.SALES_MANAGER)
  ) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Access restricted to Admin and Sales Manager only.'
    });
  }
  next();
};

const verifyCreateUserPermission = async (req, res, next) => {
  const targetRole = req.body.role || ROLES.SALES_EXECUTIVE;

  if (targetRole === ROLES.ADMIN) {
    return next();
  }

  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    const requiredRole =
      targetRole === ROLES.SALES_MANAGER
        ? 'Only an Admin can create a Sales Manager.'
        : 'Only an Admin or Sales Manager can create a Sales Executive.';
    return res.status(401).json({
      success: false,
      message: `Authentication token is required. ${requiredRole}`
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'crm_jwt_secret_key_super_secure_random_string_2026'
    );

    const currentUser = await User.findById(decoded.id).select('-password');
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'The user belonging to this token no longer exists.'
      });
    }

    if (!currentUser.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact an administrator.'
      });
    }

    if (targetRole === ROLES.SALES_MANAGER && currentUser.role !== ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only an Admin can create a Sales Manager.'
      });
    }

    if (
      targetRole === ROLES.SALES_EXECUTIVE &&
      currentUser.role !== ROLES.ADMIN &&
      currentUser.role !== ROLES.SALES_MANAGER
    ) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only an Admin or Sales Manager can create a Sales Executive.'
      });
    }

    req.user = currentUser;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized. Invalid or expired token.'
    });
  }
};

module.exports = {
  protect,
  authorize,
  accessByAdmin,
  accessByManager,
  accessByExecutive,
  accessByAdminOrManager,
  verifyCreateUserPermission
};
