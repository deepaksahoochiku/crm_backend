const jwt = require('jsonwebtoken');

const generateToken = (userId, role) => {
  return jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET || 'crm_jwt_secret_key_super_secure_random_string_2026',
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
  );
};

module.exports = { generateToken };
