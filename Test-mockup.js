/**
 * Test script for WhatsApp bot
 * 
 * This script simulates events to test the bot without connecting to WhatsApp
 */
// Load environment variables
require('dotenv').config();

const EventEmitter = require('events');
const WhatsAppBot = require('./src/WhatsAppBot');
const EventHandler = require('./src/EventHandler');
const Logger = require('./src/utils/Logger');
const NSFWPredict = require('./src/utils/NSFWPredict');
const fs = require('fs').promises;
const path = require('path');

// Create logger for test script
const logger = new Logger('test');

// Mock the whatsapp-web.js Client class
class MockClient extends EventEmitter {
  constructor() {
    super();
    this.info = { 
      wid: { 
        _serialized: '1234567890@c.us' 
      } 
    };
    this.getBlockedContacts = () => ([]);
  }

  async initialize() {
    logger.info('Mock client initialized');
    // Emit authenticated and ready events immediately
    setTimeout(() => {
      this.emit('authenticated');
      this.emit('ready');
    }, 100);
    return this;
  }

  async destroy() {
    logger.info('Mock client destroyed');
    return this;
  }

  async sendMessage(chatId, content, options = {}) {
    logger.info(`Sending message to ${chatId}: ${typeof content === 'string' ? content : '[Media]'}`);
    logger.debug('Message options:', options);
    return { id: { _serialized: 'mock-msg-id' } };
  }

  async sendPresenceUpdate(status, chatId) {
    logger.info(`Updating presence for ${chatId}: ${status}`);
  }

  // This was missing - add mock implementation
  async waitForLogin() {
    logger.info('Mock waitForLogin called');
    return true;
  }

  async requestCode(phoneNumber) {
    logger.info(`Mock requesting code for ${phoneNumber}`);
  }
}

// Create a mock version of WhatsAppBot
class MockWhatsAppBot extends WhatsAppBot {
  constructor(options) {
    super(options);
  }
  
  // Override the initialize method
  async initialize() {
    this.logger.info(`Initializing bot instance ${this.id}`);
    
    // Create mock client
    this.client = new MockClient();
    
    // Register event handlers
    this.registerEventHandlers();
    
    // Emit the ready event after a short delay
    setTimeout(() => {
      this.client.emit('authenticated');
      this.client.emit('ready');
    }, 100);
    
    this.logger.info(`Bot ${this.id} initialized`);
    return this;
  }
}

// Helper class to simulate events
class BotSimulator {
  constructor(bot) {
    this.bot = bot;
    this.logger = new Logger('simulator');
  }

  // Simulate a text message
  async simulateTextMessage(fromId, groupId, text) {
    this.logger.info(`Simulating text message from ${fromId} in group ${groupId || 'private'}: ${text}`);
    
    // Create mock message object
    const message = {
      id: { _serialized: `mock-msg-${Date.now()}` },
      body: text,
      from: fromId,
      to: groupId || this.bot.client.info.wid._serialized,
      hasMedia: false,
      type: 'chat',
      
      // Mock methods
      getChat: async () => ({
        id: { _serialized: groupId || fromId },
        name: groupId ? 'Test Group' : 'Test User',
        isGroup: !!groupId
      }),
      getContact: async () => ({
        id: { _serialized: fromId },
        pushname: 'Test User'
      }),
      downloadMedia: async () => null,
      react: async (emoji) => {
        this.logger.info(`Reacted with ${emoji} to message`);
      },
      delete: async () => {
        this.logger.info(`Deleted message`);
      },
      getQuotedMessage: async () => null,
      quotedMsg: null
    };
    
    // Emit message event
    this.bot.client.emit('message', message);
    return message;
  }

  // Simulate an image message
  async simulateImageMessage(fromId, groupId, text = '', quotedMsg = null) {
    this.logger.info(`Simulating image message from ${fromId} in group ${groupId || 'private'}`);
    
    try {
      // Read image file
      const imagePath = path.join(__dirname, 'data', 'example-image.jpg');
      console.log(imagePath);
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      
      // Create mock message object
      const message = {
        id: { _serialized: `mock-msg-${Date.now()}` },
        body: text,
        from: fromId,
        to: groupId || this.bot.client.info.wid._serialized,
        hasMedia: true,
        type: 'image',
        
        // Mock methods
        getChat: async () => ({
          id: { _serialized: groupId || fromId },
          name: groupId ? 'Test Group' : 'Test User',
          isGroup: !!groupId
        }),
        getContact: async () => ({
          id: { _serialized: fromId },
          pushname: 'Test User'
        }),
        downloadMedia: async () => ({
          data: base64Image,
          mimetype: 'image/jpeg',
          filename: 'example-image.jpg'
        }),
        react: async (emoji) => {
          this.logger.info(`Reacted with ${emoji} to message`);
        },
        delete: async () => {
          this.logger.info(`Deleted message`);
        },
        getQuotedMessage: async () => quotedMsg,
        quotedMsg: quotedMsg,
        // Add a content property for easy access to media data
        content: {
          data: base64Image,
          mimetype: 'image/jpeg',
          filename: 'example-image.jpg'
        }
      };
      
      // Add origin for compatibility with some commands
      message.origin = message;
      
      // Emit message event
      this.bot.client.emit('message', message);
      return message;
    } catch (error) {
      this.logger.error('Error simulating image message:', error);
      throw error;
    }
  }

  // Simulate a video message
  async simulateVideoMessage(fromId, groupId, text = '', quotedMsg = null) {
    this.logger.info(`Simulating video message from ${fromId} in group ${groupId || 'private'}`);
    
    try {
      // Read video file
      const videoPath = path.join(__dirname, 'data', 'example-video.mp4');
      const videoBuffer = await fs.readFile(videoPath);
      const base64Video = videoBuffer.toString('base64');
      
      // Create mock message object
      const message = {
        id: { _serialized: `mock-msg-${Date.now()}` },
        body: text,
        from: fromId,
        to: groupId || this.bot.client.info.wid._serialized,
        hasMedia: true,
        type: 'video',
        
        // Mock methods
        getChat: async () => ({
          id: { _serialized: groupId || fromId },
          name: groupId ? 'Test Group' : 'Test User',
          isGroup: !!groupId
        }),
        getContact: async () => ({
          id: { _serialized: fromId },
          pushname: 'Test User'
        }),
        downloadMedia: async () => ({
          data: base64Video,
          mimetype: 'video/mp4',
          filename: 'example-video.mp4'
        }),
        react: async (emoji) => {
          this.logger.info(`Reacted with ${emoji} to message`);
        },
        delete: async () => {
          this.logger.info(`Deleted message`);
        },
        getQuotedMessage: async () => quotedMsg,
        quotedMsg: quotedMsg,
        // Add a content property for easy access to media data
        content: {
          data: base64Video,
          mimetype: 'video/mp4',
          filename: 'example-video.mp4'
        }
      };
      
      // Add origin for compatibility with some commands
      message.origin = message;
      
      // Emit message event
      this.bot.client.emit('message', message);
      return message;
    } catch (error) {
      this.logger.error('Error simulating video message:', error);
      throw error;
    }
  }

  // Simulate a group join event
  async simulateGroupJoin(groupId, userId) {
    this.logger.info(`Simulating group join: ${userId} joined ${groupId}`);
    
    // Create mock notification object
    const notification = {
      id: { _serialized: `mock-notification-${Date.now()}` },
      type: 'group_join',
      user: {id: {_serialized: userId, name: "Batata"}},
      getRecipients: () => [userId],
      // Mock methods
      getChat: async () => ({
        id: { _serialized: groupId },
        name: 'Test Group',
        isGroup: true,
        participants: [
          { id: { _serialized: userId } },
          { id: { _serialized: this.bot.client.info.wid._serialized } }
        ],
        groupMetadata: {
          participants: [
            { id: { _serialized: userId } },
            { id: { _serialized: this.bot.client.info.wid._serialized } }
          ],
          desc: 'Test Group Description'
        }
      }),
      getContact: async () => ({
        id: { _serialized: userId },
        pushname: 'New User',
        name: 'New User',
        number: userId.split('@')[0]
      })
    };
    
    // Emit group_join event
    this.bot.client.emit('group_join', notification);
    return notification;
  }

  // Simulate a group leave event
  async simulateGroupLeave(groupId, userId) {
    this.logger.info(`Simulating group leave: ${userId} left ${groupId}`);
    
    // Create mock notification object
    const notification = {
      id: { _serialized: `mock-notification-${Date.now()}` },
      type: 'group_leave',
      
      // Mock methods
      getChat: async () => ({
        id: { _serialized: groupId },
        name: 'Test Group'
      }),
      getContact: async () => ({
        id: { _serialized: userId },
        pushname: 'Leaving User'
      })
    };
    
    // Emit group_leave event
    this.bot.client.emit('group_leave', notification);
    return notification;
  }
}

// Main test function
async function runTests() {
  try {
    // Create event handler and bot
    const eventHandler = new EventHandler();
    const bot = new MockWhatsAppBot({
      id: 'test-bot',
      phoneNumber: '1234567890',
      eventHandler,
      prefix: '!',
      evolutionApiUrl: "http://localhost",
      evolutionApiKey: "12345",
      evoInstanceName: "mockup",
      instanceName: "mockup",
      webhookHost: "http://localhost"
    });
    
    // Initialize bot and database
    await bot.initialize();
    
    // Wait for the bot to be ready
    await new Promise(resolve => setTimeout(resolve, 200));
    
    if (!bot.client || !bot.client.info || !bot.client.info.wid) {
      throw new Error('Bot client or client.info.wid is undefined after initialization');
    }
    
    // Create simulator
    const simulator = new BotSimulator(bot);
    
    // Run example tests
    const testUser = '55123456789@c.us';
    const testGroup = '120363404335114899@g.us';
    
    // First, we need to ensure the database has the test group
    logger.info('Setting up test environment...');
    
    // Test: Simulating sticker commands with images
    //logger.info('TEST: Sending image with sq command');
    // First image message
    //const imageMessage = await simulator.simulateImageMessage(testUser, testGroup, '!sbg');
    
    // // Wait for message processing
    // await new Promise(resolve => setTimeout(resolve, 1000));
    
    // // Test another sticker command
    // logger.info('TEST: Sending image with sqc command');
    // await simulator.simulateImageMessage(testUser, testGroup, '!sqc Teste 2');
    
    // // Wait for message processing
    // await new Promise(resolve => setTimeout(resolve, 1000));
    
    // // Test with quoted message
    // logger.info('TEST: Sending message that quotes an image for sqb command');
     //await simulator.simulateTextMessage(testUser, testGroup, '!sbg', imageMessage);
    
    // // Wait for message processing
    // await new Promise(resolve => setTimeout(resolve, 1000));
    
    // // Test video processing
    // logger.info('TEST: Sending video with sq command');
    // await simulator.simulateVideoMessage(testUser, testGroup, '!sq Video teste');
    
    // // Wait for message processing
    await new Promise(resolve => setTimeout(resolve, 5000));
    logger.info('sending');

    await simulator.simulateTextMessage(testUser, testGroup, '!psn-platinas BobRiku');

    //logger.info('joining');    
    //await simulator.simulateGroupJoin(testGroup, testUser);
    
    logger.info('All tests completed successfully');
  } catch (error) {
    logger.error('Error running tests:', error);
  }
}

// Run the tests
runTests().catch(console.error);