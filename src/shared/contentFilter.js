/**
 * ContentFilter - Removes boilerplate content from scraped pages
 * Optimized for content quality
 */

import { getSiteConfig } from './filterConfig.js';

export class ContentFilter {
  constructor(config = null) {
    this.config = config || getSiteConfig('default');
    this.compiledPatterns = this.compilePatterns();
    this.seenContent = new Map();
    this.maxMapSize = 1000; // Prevent memory leak
    this.metrics = {
      totalFiltered: 0,
      processingTime: 0,
      falsePositives: 0,
      bytesProcessed: 0,
      bytesFiltered: 0,
    };
  }

  /**
   * Pre-compile regex patterns for performance
   */
  compilePatterns() {
    return this.config.patterns
      .map((p) => {
        const compiled = { ...p };

        if (p.type === 'regex' && p.source) {
          try {
            compiled.compiled = new RegExp(p.source, p.flags || 'g');
          } catch (e) {
            console.warn(`Failed to compile regex pattern ${p.id}:`, e);
            compiled.disabled = true;
          }
        } else if (p.type === 'smart' && p.pattern instanceof RegExp) {
          compiled.compiled = p.pattern;
        }

        compiled.confidence = p.confidence || 1.0;
        return compiled;
      })
      .filter((p) => !p.disabled);
  }

  /**
   * Main filtering function with confidence scoring
   * @param {string} content - Content to filter
   * @param {Object} context - Additional context (url, domain, etc.)
   * @returns {string} Filtered content
   */
  filterContent(content, context = {}) {
    if (!content || typeof content !== 'string') {
      return content;
    }

    const startTime = performance.now();
    const originalLength = content.length;

    try {
      // Single pass with priority ordering
      let filtered = this.applyPatternFilters(content, context);
      filtered = this.removeSmartRepetitions(filtered);
      filtered = this.cleanFormatting(filtered);

      // Update metrics
      this.metrics.processingTime = performance.now() - startTime;
      this.metrics.bytesProcessed += originalLength;
      this.metrics.bytesFiltered += originalLength - filtered.length;

      return filtered;
    } catch (error) {
      console.error('Filtering failed, returning original content:', error);
      return content; // Graceful degradation
    }
  }

  /**
   * Apply pattern-based filters
   */
  applyPatternFilters(text, context) {
    let result = text;

    // Sort patterns by priority (higher priority first)
    const sortedPatterns = [...this.compiledPatterns].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );

    for (const pattern of sortedPatterns) {
      // Skip if confidence is below threshold
      if (pattern.confidence < this.config.minConfidence) {
        continue;
      }

      result = this.applyPattern(result, pattern, context);
    }

    return result;
  }

  /**
   * Apply a single pattern with timeout protection
   */
  applyPattern(text, pattern, context) {
    switch (pattern.type) {
      case 'exact':
        if (pattern.pattern) {
          const before = text.length;
          const result = text.split(pattern.pattern).join(pattern.replacement || '');
          if (result.length < before) {
            this.metrics.totalFiltered++;
          }
          return result;
        }
        return text;

      case 'regex':
        if (pattern.compiled) {
          return this.applyRegexWithTimeout(text, pattern);
        }
        return text;

      case 'smart':
        return this.smartFilter(text, pattern, context);

      default:
        return text;
    }
  }

  /**
   * Apply regex with timeout protection against catastrophic backtracking
   * Note: Simplified to synchronous for now - async timeout protection needs different approach
   */
  applyRegexWithTimeout(text, pattern) {
    try {
      const before = text.length;
      const result = text.replace(pattern.compiled, pattern.replacement || '');
      if (result.length < before) {
        this.metrics.totalFiltered++;
      }
      return result;
    } catch (error) {
      console.warn(`Pattern ${pattern.id} failed:`, error.message);
      return text; // Return original on error
    }
  }

  /**
   * Context-aware smart filtering
   */
  smartFilter(text, pattern, context) {
    const lines = text.split('\n');
    const filtered = [];
    let inCodeBlock = false;
    let removedCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track code blocks
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        filtered.push(line);
        continue;
      }

      // Skip filtering in code blocks if configured
      if (inCodeBlock && pattern.skipInCode) {
        filtered.push(line);
        continue;
      }

      // Apply smart filtering
      if (!this.matchesSmartPattern(line, pattern, context)) {
        filtered.push(line);
      } else {
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.metrics.totalFiltered += removedCount;
    }

    return filtered.join('\n');
  }

  /**
   * Check if line matches smart pattern with context awareness
   */
  matchesSmartPattern(line, pattern, _context) {
    if (!line || !pattern.compiled) {
      return false;
    }

    const trimmedLine = line.trim();

    // Empty lines are never filtered
    if (trimmedLine.length === 0) {
      return false;
    }

    // Special handling for cookie/privacy content in technical context
    if (pattern.id === 'cookie-policy-start' || pattern.id === 'privacy-footer') {
      const lowerLine = trimmedLine.toLowerCase();

      // Preserve if it's in a technical context
      const technicalKeywords = [
        'implementation',
        'function',
        'class',
        'method',
        'api',
        'code',
        'algorithm',
        'develop',
        'program',
        'script',
      ];

      for (const keyword of technicalKeywords) {
        if (lowerLine.includes(keyword)) {
          return false; // Don't filter technical content
        }
      }
    }

    // Test the pattern
    return pattern.compiled.test(trimmedLine);
  }

  /**
   * Remove smart repetitions with proper deduplication
   */
  removeSmartRepetitions(text) {
    if (!text) {
      return text;
    }

    // Clean old entries if map is too large
    if (this.seenContent.size > this.maxMapSize) {
      const entriesToKeep = Array.from(this.seenContent.entries()).slice(
        -Math.floor(this.maxMapSize / 2)
      );
      this.seenContent = new Map(entriesToKeep);
    }

    const sections = text.split(/\n{2,}/);
    const filtered = [];

    for (const section of sections) {
      const trimmed = section.trim();

      // Skip empty sections
      if (trimmed.length === 0) {
        continue;
      }

      // Skip very short sections (likely artifacts)
      if (trimmed.length < 10) {
        filtered.push(section);
        continue;
      }

      const hash = this.hashContent(trimmed);
      const count = this.seenContent.get(hash) || 0;

      if (count < this.config.maxRepetitions) {
        filtered.push(section);
        this.seenContent.set(hash, count + 1);
      } else {
        this.metrics.totalFiltered++;
      }
    }

    return filtered.join('\n\n');
  }

  /**
   * Generate hash for content deduplication
   */
  hashContent(text) {
    // Normalize text for hashing
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').substring(0, 200); // Use first 200 chars for hash

    // Simple but effective hash function
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Clean up formatting issues
   */
  cleanFormatting(text) {
    if (!text) {
      return text;
    }

    return text
      .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
      .replace(/[ \t]+$/gm, '') // Remove trailing whitespace
      .replace(/^\s+|\s+$/g, '') // Trim start and end
      .replace(/\t/g, '  '); // Convert tabs to spaces
  }

  /**
   * Clear memory between scraping sessions
   */
  reset() {
    this.seenContent.clear();
    this.metrics = {
      totalFiltered: 0,
      processingTime: 0,
      falsePositives: 0,
      bytesProcessed: 0,
      bytesFiltered: 0,
    };
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    const reductionPercent =
      this.metrics.bytesProcessed > 0
        ? ((this.metrics.bytesFiltered / this.metrics.bytesProcessed) * 100).toFixed(2)
        : 0;

    return {
      ...this.metrics,
      memoryUsage: this.seenContent.size,
      reductionPercent: `${reductionPercent}%`,
    };
  }

  /**
   * Update configuration (e.g., for site-specific settings)
   */
  updateConfig(hostname) {
    this.config = getSiteConfig(hostname);
    this.compiledPatterns = this.compilePatterns();
  }
}
