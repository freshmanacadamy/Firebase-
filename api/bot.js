const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [];

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is required');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Initialize Firebase
let db;
try {
  if (FIREBASE_PRIVATE_KEY && FIREBASE_CLIENT_EMAIL) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        privateKey: FIREBASE_PRIVATE_KEY,
        clientEmail: FIREBASE_CLIENT_EMAIL,
      })
    });
    db = admin.firestore();
    console.log('✅ Firebase initialized successfully');
  } else {
    console.log('⚠️ Firebase credentials not set - using in-memory storage');
    db = null;
  }
} catch (error) {
  console.error('❌ Firebase initialization failed:', error);
  db = null;
}

// In-memory fallback
const usersMemory = new Map();
const userStates = new Map();

// Main menu
const showMainMenu = async (chatId) => {
  const options = {
    reply_markup: {
      keyboard: [
        [{ text: '👤 Register User' }, { text: '📊 My Info' }],
        [{ text: '📋 All Users' }, { text: '📤 Export Data' }],
        [{ text: 'ℹ️ Help' }]
      ],
      resize_keyboard: true
    }
  };
  
  await bot.sendMessage(chatId, 
    `🔥 *Firebase User Test Bot*\n\n` +
    `Test user data storage and management!\n\n` +
    `Choose an option below:`,
    { parse_mode: 'Markdown', ...options }
  );
};

// Start command
const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  await bot.sendMessage(chatId, 
    `👋 *Welcome to Firebase Test Bot!*\n\n` +
    `This bot tests Firebase user data storage:\n` +
    `✅ Register user information\n` +
    `📊 View your stored data\n` +
    `📋 List all users (Admin)\n` +
    `📤 Export user data (Admin)\n\n` +
    `Start by registering your info!`,
    { parse_mode: 'Markdown' }
  );
  
  await showMainMenu(chatId);
};

// Save user to Firebase or memory
const saveUser = async (userData) => {
  try {
    if (db) {
      // Save to Firebase
      await db.collection('users').doc(userData.telegramId.toString()).set({
        ...userData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log('✅ User saved to Firebase');
      return true;
    } else {
      // Save to memory
      usersMemory.set(userData.telegramId, {
        ...userData,
        updatedAt: new Date()
      });
      console.log('✅ User saved to memory');
      return true;
    }
  } catch (error) {
    console.error('❌ Error saving user:', error);
    return false;
  }
};

// Get user from Firebase or memory
const getUser = async (telegramId) => {
  try {
    if (db) {
      const doc = await db.collection('users').doc(telegramId.toString()).get();
      return doc.exists ? doc.data() : null;
    } else {
      return usersMemory.get(telegramId) || null;
    }
  } catch (error) {
    console.error('❌ Error getting user:', error);
    return null;
  }
};

// Get all users from Firebase or memory
const getAllUsers = async () => {
  try {
    if (db) {
      const snapshot = await db.collection('users').get();
      return snapshot.docs.map(doc => doc.data());
    } else {
      return Array.from(usersMemory.values());
    }
  } catch (error) {
    console.error('❌ Error getting all users:', error);
    return [];
  }
};

// User registration flow
const handleRegister = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  userStates.set(userId, {
    state: 'awaiting_name',
    userData: {
      telegramId: userId,
      username: msg.from.username || '',
      firstName: msg.from.first_name || '',
      lastName: msg.from.last_name || '',
      joinedAt: new Date()
    }
  });
  
  await bot.sendMessage(chatId,
    `👤 *User Registration - Step 1/3*\n\n` +
    `Please enter your full name:`,
    { parse_mode: 'Markdown' }
  );
};

// Continue registration
const continueRegistration = async (msg, userState) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  switch (userState.state) {
    case 'awaiting_name':
      userState.userData.fullName = text;
      userState.state = 'awaiting_department';
      userStates.set(userId, userState);
      
      await bot.sendMessage(chatId,
        `🎓 *Step 2/3 - Department*\n\n` +
        `Enter your department:`,
        { parse_mode: 'Markdown' }
      );
      break;
      
    case 'awaiting_department':
      userState.userData.department = text;
      userState.state = 'awaiting_year';
      userStates.set(userId, userState);
      
      await bot.sendMessage(chatId,
        `📅 *Step 3/3 - Year*\n\n` +
        `Enter your academic year:\n` +
        `(e.g., 1st, 2nd, 3rd, 4th, 5th)`,
        { parse_mode: 'Markdown' }
      );
      break;
      
    case 'awaiting_year':
      userState.userData.year = text;
      userState.userData.updatedAt = new Date();
      
      // Save user data
      const success = await saveUser(userState.userData);
      
      if (success) {
        await bot.sendMessage(chatId,
          `✅ *Registration Complete!*\n\n` +
          `👤 *Name:* ${userState.userData.fullName}\n` +
          `🎓 *Department:* ${userState.userData.department}\n` +
          `📅 *Year:* ${userState.userData.year}\n\n` +
          `Your information has been saved ${db ? 'to Firebase' : 'in memory'}!`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await bot.sendMessage(chatId, '❌ Failed to save your information. Please try again.');
      }
      
      userStates.delete(userId);
      await showMainMenu(chatId);
      break;
  }
};

// View user info
const handleMyInfo = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const userData = await getUser(userId);
  
  if (!userData) {
    await bot.sendMessage(chatId,
      `📊 *My Information*\n\n` +
      `You haven't registered yet.\n\n` +
      `Use "👤 Register User" to get started!`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  await bot.sendMessage(chatId,
    `📊 *Your Information*\n\n` +
    `👤 *Name:* ${userData.fullName || 'Not set'}\n` +
    `🎓 *Department:* ${userData.department || 'Not set'}\n` +
    `📅 *Year:* ${userData.year || 'Not set'}\n` +
    `🆔 *Telegram ID:* ${userData.telegramId}\n` +
    `👤 *Username:* @${userData.username || 'Not set'}\n` +
    `📅 *Joined:* ${userData.joinedAt?.toDate?.()?.toLocaleDateString() || userData.joinedAt?.toLocaleDateString() || 'Unknown'}\n\n` +
    `💾 *Storage:* ${db ? 'Firebase' : 'Memory'}`,
    { parse_mode: 'Markdown' }
  );
};

// List all users (Admin only)
const handleAllUsers = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!ADMIN_IDS.includes(userId)) {
    await bot.sendMessage(chatId, '❌ Admin access required.');
    return;
  }
  
  const allUsers = await getAllUsers();
  
  if (allUsers.length === 0) {
    await bot.sendMessage(chatId, '📋 No users registered yet.');
    return;
  }
  
  let message = `📋 *All Users (${allUsers.length})*\n\n`;
  
  allUsers.forEach((user, index) => {
    message += `${index + 1}. 👤 ${user.fullName || user.firstName}\n`;
    message += `   🎓 ${user.department || 'No department'} | 📅 ${user.year || 'No year'}\n`;
    message += `   🆔 ${user.telegramId}\n\n`;
  });
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
};

// Export user data (Admin only)
const handleExportData = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!ADMIN_IDS.includes(userId)) {
    await bot.sendMessage(chatId, '❌ Admin access required.');
    return;
  }
  
  const allUsers = await getAllUsers();
  
  if (allUsers.length === 0) {
    await bot.sendMessage(chatId, '📤 No data to export.');
    return;
  }
  
  // Create CSV data
  const csvData = [
    ['Telegram ID', 'Full Name', 'Username', 'Department', 'Year', 'Joined Date'],
    ...allUsers.map(user => [
      user.telegramId,
      user.fullName || '',
      user.username || '',
      user.department || '',
      user.year || '',
      user.joinedAt?.toDate?.()?.toISOString() || user.joinedAt?.toISOString() || ''
    ])
  ].map(row => row.join(',')).join('\n');
  
  // Send as file
  await bot.sendDocument(chatId, Buffer.from(csvData), {}, {
    filename: `users_export_${new Date().toISOString().split('T')[0]}.csv`,
    contentType: 'text/csv'
  });
  
  await bot.sendMessage(chatId,
    `✅ *Data Exported Successfully!*\n\n` +
    `📊 Total users: ${allUsers.length}\n` +
    `💾 Storage: ${db ? 'Firebase' : 'Memory'}\n` +
    `📅 Export date: ${new Date().toLocaleDateString()}`,
    { parse_mode: 'Markdown' }
  );
};

// Help command
const handleHelp = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const isAdmin = ADMIN_IDS.includes(userId);
  
  let helpMessage = `ℹ️ *Firebase Test Bot Help*\n\n` +
    `*User Commands:*\n` +
    `👤 Register User - Register your information\n` +
    `📊 My Info - View your stored data\n` +
    `ℹ️ Help - Show this help message\n\n` +
    `*Storage:* ${db ? 'Firebase (Live)' : 'Memory (Test)'}\n\n` +
    `This bot tests user data storage and management.`;
  
  if (isAdmin) {
    helpMessage += `\n\n*⚡ Admin Commands:*\n` +
      `📋 All Users - List all registered users\n` +
      `📤 Export Data - Download user data as CSV`;
  }
  
  await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
};

// Message handler
const handleMessage = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  if (!text) return;
  
  // Check if user is in registration flow
  const userState = userStates.get(userId);
  if (userState) {
    await continueRegistration(msg, userState);
    return;
  }
  
  if (text.startsWith('/')) {
    switch (text) {
      case '/start':
        await handleStart(msg);
        break;
      case '/help':
      case 'ℹ️ Help':
        await handleHelp(msg);
        break;
      default:
        await showMainMenu(chatId);
    }
  } else {
    switch (text) {
      case '👤 Register User':
        await handleRegister(msg);
        break;
      case '📊 My Info':
        await handleMyInfo(msg);
        break;
      case '📋 All Users':
        await handleAllUsers(msg);
        break;
      case '📤 Export Data':
        await handleExportData(msg);
        break;
      default:
        await showMainMenu(chatId);
    }
  }
};

// Vercel handler
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method === 'GET') {
    const allUsers = await getAllUsers();
    return res.json({ 
      status: 'Firebase Test Bot is running!',
      storage: db ? 'firebase' : 'memory',
      users_count: allUsers.length,
      timestamp: new Date().toISOString()
    });
  }
  
  if (req.method === 'POST') {
    try {
      const update = req.body;
      
      if (update.message) {
        await handleMessage(update.message);
      }
      
      return res.json({ ok: true });
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
};

console.log('✅ Firebase Test Bot configured for Vercel!');
