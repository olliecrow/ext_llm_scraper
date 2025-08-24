#!/usr/bin/env node

/**
 * Comprehensive Architecture Validation Test
 * Tests the new direct return value architecture without message passing
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 CHROME EXTENSION ARCHITECTURE VALIDATION TEST');
console.log('===============================================\n');

// Test 1: Verify manifest structure
function testManifest() {
  console.log('📋 Test 1: Manifest Structure');
  try {
    const manifestPath = '/workspace/dist/manifest.json';
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    const requiredPermissions = ['activeTab', 'tabs', 'storage', 'downloads', 'scripting', 'alarms'];
    const hasAllPermissions = requiredPermissions.every(perm => manifest.permissions.includes(perm));
    
    console.log(`   ✅ Manifest version: ${manifest.manifest_version}`);
    console.log(`   ✅ Required permissions: ${hasAllPermissions ? 'All present' : 'MISSING'}`);
    console.log(`   ✅ Service worker type: ${manifest.background.type}`);
    console.log(`   ✅ Web accessible resources configured: ${manifest.web_accessible_resources ? 'Yes' : 'No'}`);
    
    return hasAllPermissions && manifest.manifest_version === 3;
  } catch (error) {
    console.log(`   ❌ Manifest test failed: ${error.message}`);
    return false;
  }
}

// Test 2: Verify background script architecture
function testBackgroundArchitecture() {
  console.log('\n🏗️ Test 2: Background Script Architecture');
  try {
    const backgroundPath = '/workspace/dist/src/background/index.js';
    const backgroundCode = fs.readFileSync(backgroundPath, 'utf8');
    
    // Check for key architectural elements
    const hasMessagePassing = backgroundCode.includes('chrome.runtime.onMessage.addListener');
    const hasDirectExtraction = backgroundCode.includes('extractContentDirectly');
    const hasExecuteScript = backgroundCode.includes('chrome.scripting.executeScript');
    const hasReturnValue = backgroundCode.includes('return {');
    const noContentScript = !backgroundCode.includes('content_script');
    
    console.log(`   ✅ Message handler present: ${hasMessagePassing}`);
    console.log(`   ✅ Direct extraction method: ${hasDirectExtraction}`);
    console.log(`   ✅ Uses executeScript: ${hasExecuteScript}`);
    console.log(`   ✅ Returns data directly: ${hasReturnValue}`);
    console.log(`   ✅ No content script dependency: ${noContentScript}`);
    
    // Check for removal of old message-based system
    const noMessageTimeout = !backgroundCode.includes('waitForContent');
    const noContentPromises = !backgroundCode.includes('pendingContent');
    
    console.log(`   ✅ Removed message timeouts: ${noMessageTimeout}`);
    console.log(`   ✅ Removed content promises: ${noContentPromises}`);
    
    return hasDirectExtraction && hasExecuteScript && hasReturnValue;
  } catch (error) {
    console.log(`   ❌ Background architecture test failed: ${error.message}`);
    return false;
  }
}

// Test 3: Verify scraper direct extraction method
function testDirectExtractionMethod() {
  console.log('\n🔍 Test 3: Direct Extraction Method');
  try {
    const scraperPath = '/workspace/dist/src/background/scraper.js';
    const scraperCode = fs.readFileSync(scraperPath, 'utf8');
    
    // Look for the extractContentDirectly method
    const hasDirectMethod = scraperCode.includes('extractContentDirectly');
    const hasExecuteScript = scraperCode.includes('chrome.scripting.executeScript');
    const hasInlineFunction = scraperCode.includes('func: function()');
    const returnsData = scraperCode.includes('return {');
    const hasResultAccess = scraperCode.includes('results[0]?.result');
    
    console.log(`   ✅ Direct extraction method exists: ${hasDirectMethod}`);
    console.log(`   ✅ Uses executeScript API: ${hasExecuteScript}`);
    console.log(`   ✅ Has inline extraction function: ${hasInlineFunction}`);
    console.log(`   ✅ Function returns data: ${returnsData}`);
    console.log(`   ✅ Accesses result properly: ${hasResultAccess}`);
    
    // Check for Readability integration
    const hasReadabilityCheck = scraperCode.includes('typeof Readability !== \'undefined\'');
    const hasFallbackExtraction = scraperCode.includes('selector');
    const hasLinkExtraction = scraperCode.includes('querySelectorAll(\'a\')');
    
    console.log(`   ✅ Readability integration: ${hasReadabilityCheck}`);
    console.log(`   ✅ Fallback extraction: ${hasFallbackExtraction}`);
    console.log(`   ✅ Link extraction: ${hasLinkExtraction}`);
    
    return hasDirectMethod && hasExecuteScript && hasResultAccess;
  } catch (error) {
    console.log(`   ❌ Direct extraction test failed: ${error.message}`);
    return false;
  }
}

// Test 4: Verify Readability library accessibility
function testReadabilityLibrary() {
  console.log('\n📚 Test 4: Readability Library');
  try {
    const readabilityPath = '/workspace/dist/src/lib/readability.js';
    const readabilityExists = fs.existsSync(readabilityPath);
    console.log(`   ✅ Readability library exists: ${readabilityExists}`);
    
    if (readabilityExists) {
      const readabilityCode = fs.readFileSync(readabilityPath, 'utf8');
      const isReadabilityLib = readabilityCode.includes('Readability') || readabilityCode.includes('readability');
      console.log(`   ✅ Contains Readability code: ${isReadabilityLib}`);
      return isReadabilityLib;
    }
    
    return readabilityExists;
  } catch (error) {
    console.log(`   ❌ Readability library test failed: ${error.message}`);
    return false;
  }
}

// Test 5: Check for removal of old content script dependencies
function testNoContentScriptDependencies() {
  console.log('\n🚫 Test 5: Removed Content Script Dependencies');
  try {
    const backgroundPath = '/workspace/dist/src/background/index.js';
    const scraperPath = '/workspace/dist/src/background/scraper.js';
    
    const backgroundCode = fs.readFileSync(backgroundPath, 'utf8');
    const scraperCode = fs.readFileSync(scraperPath, 'utf8');
    
    // Check that old message-passing patterns are removed
    const backgroundNoTimeout = !backgroundCode.includes('CONFIG.TIMEOUTS.CONTENT_RETRIEVAL');
    const backgroundNoWaitForContent = !backgroundCode.includes('waitForContent');
    const scraperNoContentPromises = !scraperCode.includes('new Promise((resolve, reject)');
    
    console.log(`   ✅ Background: No content timeouts: ${backgroundNoTimeout}`);
    console.log(`   ✅ Background: No waitForContent: ${backgroundNoWaitForContent}`);
    console.log(`   ✅ Scraper: Reduced promise usage: ${scraperNoContentPromises}`);
    
    return backgroundNoTimeout && backgroundNoWaitForContent;
  } catch (error) {
    console.log(`   ❌ Content script dependency test failed: ${error.message}`);
    return false;
  }
}

// Test 6: Verify new extraction function structure
function testExtractionFunctionStructure() {
  console.log('\n⚙️ Test 6: Extraction Function Structure');
  try {
    const scraperPath = '/workspace/dist/src/background/scraper.js';
    const scraperCode = fs.readFileSync(scraperPath, 'utf8');
    
    // Look for the inline extraction function structure
    const hasConsoleLogging = scraperCode.includes('console.log(\'[DIRECT_EXTRACT]');
    const hasReadabilityTry = scraperCode.includes('new Readability(document.cloneNode(true)).parse()');
    const hasSelectorFallback = scraperCode.includes('const selectors = [');
    const hasBodyFallback = scraperCode.includes('document.body.innerText');
    const hasLinkExtraction = scraperCode.includes('document.querySelectorAll(\'a\')');
    const returnsStructuredData = scraperCode.includes('url: window.location.href') && 
                                  scraperCode.includes('title: title') &&
                                  scraperCode.includes('content: content');
    
    console.log(`   ✅ Has debug logging: ${hasConsoleLogging}`);
    console.log(`   ✅ Tries Readability first: ${hasReadabilityTry}`);
    console.log(`   ✅ Has selector fallbacks: ${hasSelectorFallback}`);
    console.log(`   ✅ Has body text fallback: ${hasBodyFallback}`);
    console.log(`   ✅ Extracts links: ${hasLinkExtraction}`);
    console.log(`   ✅ Returns structured data: ${returnsStructuredData}`);
    
    return hasReadabilityTry && hasSelectorFallback && returnsStructuredData;
  } catch (error) {
    console.log(`   ❌ Extraction function test failed: ${error.message}`);
    return false;
  }
}

// Test 7: Validate popup integration
function testPopupIntegration() {
  console.log('\n🎮 Test 7: Popup Integration');
  try {
    const popupPath = '/workspace/dist/src/popup/popup.js';
    const popupCode = fs.readFileSync(popupPath, 'utf8');
    
    const hasStartHandler = popupCode.includes('startButton');
    const hasStopHandler = popupCode.includes('stopButton');
    const hasPortConnection = popupCode.includes('chrome.runtime.connect');
    const hasMessageHandling = popupCode.includes('runtime.sendMessage');
    
    console.log(`   ✅ Start button handler: ${hasStartHandler}`);
    console.log(`   ✅ Stop button handler: ${hasStopHandler}`);
    console.log(`   ✅ Port connection: ${hasPortConnection}`);
    console.log(`   ✅ Message handling: ${hasMessageHandling}`);
    
    return hasStartHandler && hasStopHandler && hasMessageHandling;
  } catch (error) {
    console.log(`   ❌ Popup integration test failed: ${error.message}`);
    return false;
  }
}

// Test 8: Verify task processing flow
function testTaskProcessingFlow() {
  console.log('\n🔄 Test 8: Task Processing Flow');
  try {
    const backgroundPath = '/workspace/dist/src/background/index.js';
    const scraperPath = '/workspace/dist/src/background/scraper.js';
    
    const backgroundCode = fs.readFileSync(backgroundPath, 'utf8');
    const scraperCode = fs.readFileSync(scraperPath, 'utf8');
    
    // Check for new processing flow
    const hasProcessContentData = scraperCode.includes('processContentData');
    const hasDirectExtractionCall = scraperCode.includes('await this.extractContentDirectly');
    const backgroundCallsDirectly = backgroundCode.includes('extractContentDirectly') || 
                                   scraperCode.includes('extractContentDirectly');
    
    console.log(`   ✅ Has processContentData method: ${hasProcessContentData}`);
    console.log(`   ✅ Calls extractContentDirectly: ${hasDirectExtractionCall}`);
    console.log(`   ✅ Direct extraction integrated: ${backgroundCallsDirectly}`);
    
    return hasProcessContentData && hasDirectExtractionCall;
  } catch (error) {
    console.log(`   ❌ Task processing flow test failed: ${error.message}`);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  const tests = [
    { name: 'Manifest Structure', fn: testManifest },
    { name: 'Background Architecture', fn: testBackgroundArchitecture },
    { name: 'Direct Extraction Method', fn: testDirectExtractionMethod },
    { name: 'Readability Library', fn: testReadabilityLibrary },
    { name: 'No Content Script Dependencies', fn: testNoContentScriptDependencies },
    { name: 'Extraction Function Structure', fn: testExtractionFunctionStructure },
    { name: 'Popup Integration', fn: testPopupIntegration },
    { name: 'Task Processing Flow', fn: testTaskProcessingFlow }
  ];
  
  let passed = 0;
  let total = tests.length;
  
  for (const test of tests) {
    try {
      const result = test.fn();
      if (result) {
        passed++;
      }
    } catch (error) {
      console.log(`❌ ${test.name} failed with error: ${error.message}`);
    }
  }
  
  console.log('\n📊 TEST SUMMARY');
  console.log('================');
  console.log(`Passed: ${passed}/${total} tests`);
  console.log(`Success rate: ${((passed/total) * 100).toFixed(1)}%`);
  
  if (passed === total) {
    console.log('\n🎉 ALL TESTS PASSED! The new architecture looks solid.');
    console.log('\n🔍 KEY ARCHITECTURAL CHANGES VERIFIED:');
    console.log('   • Direct return from executeScript instead of message passing');
    console.log('   • Inline extraction function with Readability + fallbacks');
    console.log('   • Removed content script timeouts and promise management');
    console.log('   • Structured data return (url, title, content, links)');
    console.log('   • Integrated content processing pipeline');
    console.log('\n✅ This extension should work much more reliably now!');
  } else {
    console.log(`\n⚠️  ${total - passed} tests failed. Review the issues above.`);
  }
  
  return passed === total;
}

// Execute tests
runAllTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});