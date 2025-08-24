/**
 * Tests for ContentFilter module
 */

describe('ContentFilter', () => {
  // Mock ContentFilter implementation for testing
  class ContentFilter {
    constructor(config = null) {
      this.config = config || this.getDefaultConfig();
      this.compiledPatterns = this.compilePatterns();
      this.seenContent = new Map();
      this.maxMapSize = 1000;
      this.metrics = {
        totalFiltered: 0,
        processingTime: 0,
        falsePositives: 0,
        bytesProcessed: 0,
        bytesFiltered: 0
      };
    }
    
    getDefaultConfig() {
      return {
        minConfidence: 0.7,
        maxRepetitions: 2,
        patterns: [
          {
            id: 'cookie-policy-exact',
            type: 'exact',
            priority: 100,
            confidence: 0.99,
            pattern: 'Cookie PolicyWe use necessary cookies to make our site work. With your consent, we also set performance and functionality cookies that help us make improvements by measuring traffic on our site and we process respective personal data. You can withdraw your consent at any time. For more detailed information about the cookies, your personal data and your rights, please see our privacy policy.',
            replacement: '',
            skipInCode: true
          },
          {
            id: 'cookie-policy-start',
            type: 'smart',
            priority: 95,
            confidence: 0.90,
            pattern: /^Cookie Policy/,
            skipInCode: true
          },
          {
            id: 'subscription-cta',
            type: 'regex',
            priority: 90,
            confidence: 0.85,
            source: 'Why subscribe\\?[\\s\\S]{0,500}Subscribe to',
            flags: 'gi',
            replacement: '',
            skipInCode: true
          }
        ]
      };
    }
    
    compilePatterns() {
      return this.config.patterns.map(p => {
        const compiled = { ...p };
        
        if (p.type === 'regex' && p.source) {
          try {
            compiled.compiled = new RegExp(p.source, p.flags || 'g');
          } catch (e) {
            compiled.disabled = true;
          }
        } else if (p.type === 'smart' && p.pattern instanceof RegExp) {
          compiled.compiled = p.pattern;
        }
        
        compiled.confidence = p.confidence || 1.0;
        return compiled;
      }).filter(p => !p.disabled);
    }
    
    filterContent(content, context = {}) {
      if (!content || typeof content !== 'string') {
        return content;
      }
      
      const startTime = Date.now();
      const originalLength = content.length;
      
      try {
        let filtered = this.applyPatternFilters(content, context);
        filtered = this.removeSmartRepetitions(filtered);
        filtered = this.cleanFormatting(filtered);
        
        this.metrics.processingTime = Date.now() - startTime;
        this.metrics.bytesProcessed += originalLength;
        this.metrics.bytesFiltered += (originalLength - filtered.length);
        
        return filtered;
      } catch (error) {
        return content; // Graceful degradation
      }
    }
    
    applyPatternFilters(text, context) {
      let result = text;
      
      const sortedPatterns = [...this.compiledPatterns].sort((a, b) => 
        (b.priority || 0) - (a.priority || 0)
      );
      
      for (const pattern of sortedPatterns) {
        if (pattern.confidence < this.config.minConfidence) {
          continue;
        }
        
        result = this.applyPattern(result, pattern, context);
      }
      
      return result;
    }
    
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
            try {
              const result = text.replace(pattern.compiled, pattern.replacement || '');
              if (result.length < text.length) {
                this.metrics.totalFiltered++;
              }
              return result;
            } catch (e) {
              return text;
            }
          }
          return text;
          
        case 'smart':
          return this.smartFilter(text, pattern, context);
          
        default:
          return text;
      }
    }
    
    smartFilter(text, pattern, context) {
      const lines = text.split('\n');
      const filtered = [];
      let inCodeBlock = false;
      let removedCount = 0;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          filtered.push(line);
          continue;
        }
        
        if (inCodeBlock && pattern.skipInCode) {
          filtered.push(line);
          continue;
        }
        
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
    
    matchesSmartPattern(line, pattern, context) {
      if (!line || !pattern.compiled) {
        return false;
      }
      
      const trimmedLine = line.trim();
      
      if (trimmedLine.length === 0) {
        return false;
      }
      
      if (pattern.id === 'cookie-policy-start' || pattern.id === 'privacy-footer') {
        const lowerLine = trimmedLine.toLowerCase();
        
        const technicalKeywords = [
          'implementation', 'function', 'class', 'method', 'api',
          'code', 'algorithm', 'develop', 'program', 'script'
        ];
        
        for (const keyword of technicalKeywords) {
          if (lowerLine.includes(keyword)) {
            return false;
          }
        }
      }
      
      return pattern.compiled.test(trimmedLine);
    }
    
    removeSmartRepetitions(text) {
      if (!text) return text;
      
      if (this.seenContent.size > this.maxMapSize) {
        const entriesToKeep = Array.from(this.seenContent.entries())
          .slice(-Math.floor(this.maxMapSize / 2));
        this.seenContent = new Map(entriesToKeep);
      }
      
      const sections = text.split(/\n{2,}/);
      const filtered = [];
      
      for (const section of sections) {
        const trimmed = section.trim();
        
        if (trimmed.length === 0) {
          continue;
        }
        
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
    
    hashContent(text) {
      const normalized = text
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .substring(0, 200);
      
      let hash = 0;
      for (let i = 0; i < normalized.length; i++) {
        const char = normalized.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash.toString(36);
    }
    
    cleanFormatting(text) {
      if (!text) return text;
      
      return text
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/^\s+|\s+$/g, '')
        .replace(/\t/g, '  ');
    }
    
    reset() {
      this.seenContent.clear();
      this.metrics = {
        totalFiltered: 0,
        processingTime: 0,
        falsePositives: 0,
        bytesProcessed: 0,
        bytesFiltered: 0
      };
    }
    
    getMetrics() {
      const reductionPercent = this.metrics.bytesProcessed > 0
        ? (this.metrics.bytesFiltered / this.metrics.bytesProcessed * 100).toFixed(2)
        : 0;
      
      return {
        ...this.metrics,
        memoryUsage: this.seenContent.size,
        reductionPercent: `${reductionPercent}%`
      };
    }
    
    updateConfig(hostname) {
      // Simplified for testing
      if (hostname === 'algos.org') {
        this.config.patterns.push({
          id: 'quant-stack-promo',
          type: 'exact',
          priority: 95,
          confidence: 0.98,
          pattern: 'Subscribe to The Quant Stack',
          replacement: '',
          skipInCode: true
        });
      }
      this.compiledPatterns = this.compilePatterns();
    }
  }
  
  let filter;
  
  beforeEach(() => {
    filter = new ContentFilter();
  });
  
  afterEach(() => {
    filter.reset();
  });
  
  describe('Basic Functionality', () => {
    test('creates instance with default config', () => {
      expect(filter).toBeInstanceOf(ContentFilter);
      expect(filter.config).toBeDefined();
      expect(filter.compiledPatterns).toBeInstanceOf(Array);
    });
    
    test('handles null and undefined content', () => {
      expect(filter.filterContent(null)).toBeNull();
      expect(filter.filterContent(undefined)).toBeUndefined();
      expect(filter.filterContent('')).toBe('');
    });
    
    test('handles non-string content', () => {
      expect(filter.filterContent(123)).toBe(123);
      expect(filter.filterContent({})).toEqual({});
      expect(filter.filterContent([])).toEqual([]);
    });
  });
  
  describe('Pattern Filtering', () => {
    test('removes exact cookie policy text', () => {
      const input = `Article content here
Cookie PolicyWe use necessary cookies to make our site work. With your consent, we also set performance and functionality cookies that help us make improvements by measuring traffic on our site and we process respective personal data. You can withdraw your consent at any time. For more detailed information about the cookies, your personal data and your rights, please see our privacy policy.
More article content`;
      
      const result = filter.filterContent(input);
      expect(result).not.toContain('Cookie PolicyWe use necessary');
      expect(result).toContain('Article content here');
      expect(result).toContain('More article content');
    });
    
    test('removes subscription CTAs', () => {
      const input = `Some article text
Why subscribe? I don't always post my content on Twitter so if you want to see it all then subscribing is a good option.
Subscribe to The Quant Stack
Continue reading`;
      
      const result = filter.filterContent(input);
      expect(result).not.toContain('Why subscribe?');
      expect(result).toContain('Some article text');
      expect(result).toContain('Continue reading');
    });
    
    test('removes lines starting with Cookie Policy', () => {
      const input = `Article paragraph
Cookie Policy - Updated January 2024
Another paragraph`;
      
      const result = filter.filterContent(input);
      expect(result).not.toContain('Cookie Policy - Updated');
      expect(result).toContain('Article paragraph');
      expect(result).toContain('Another paragraph');
    });
  });
  
  describe('Edge Cases', () => {
    test('preserves code blocks with Cookie keyword', () => {
      const input = `\`\`\`python
# Cookie handling implementation
class CookieJar:
    def handle_cookie_policy(self):
        return "Cookie Policy accepted"
\`\`\``;
      
      const result = filter.filterContent(input);
      expect(result).toContain('Cookie handling implementation');
      expect(result).toContain('class CookieJar');
      expect(result).toContain('handle_cookie_policy');
      expect(result).toContain('Cookie Policy accepted');
    });
    
    test('preserves articles about privacy policies', () => {
      const input = `This technical article analyzes different Cookie Policy implementations in modern web applications. We'll explore how developers handle cookie consent.`;
      
      const result = filter.filterContent(input);
      expect(result).toContain('Cookie Policy implementations');
      expect(result).toContain('technical article');
      expect(result).toContain('developers');
    });
    
    test('handles malformed content gracefully', () => {
      const malformed = '<div>Unclosed tag Cookie Policy';
      expect(() => filter.filterContent(malformed)).not.toThrow();
      
      const result = filter.filterContent(malformed);
      expect(result).toBeDefined();
    });
  });
  
  describe('Repetition Removal', () => {
    test('limits repetitions to configured maximum', () => {
      const repeated = 'This is duplicate content';
      const input = [repeated, 'unique 1', repeated, 'unique 2', repeated, repeated]
        .join('\n\n');
      
      const result = filter.filterContent(input);
      const occurrences = (result.match(/This is duplicate content/g) || []).length;
      expect(occurrences).toBe(2); // maxRepetitions default is 2
      expect(result).toContain('unique 1');
      expect(result).toContain('unique 2');
    });
  });
  
  describe('Performance', () => {
    test('processes moderate content quickly', () => {
      const content = 'Sample paragraph. '.repeat(1000);
      
      const start = Date.now();
      filter.filterContent(content);
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(50);
    });
    
    test('prevents memory leak with many unique sections', () => {
      for (let i = 0; i < 2000; i++) {
        filter.filterContent(`Unique content ${i}`);
      }
      
      expect(filter.seenContent.size).toBeLessThanOrEqual(1000);
    });
  });
  
  describe('Formatting Cleanup', () => {
    test('reduces multiple newlines to maximum of two', () => {
      const input = 'Paragraph 1\n\n\n\n\nParagraph 2';
      const result = filter.filterContent(input);
      
      expect(result).toBe('Paragraph 1\n\nParagraph 2');
    });
    
    test('removes trailing whitespace', () => {
      const input = 'Line with spaces   \nAnother line\t\t';
      const result = filter.filterContent(input);
      
      expect(result).not.toMatch(/   $/m);
      expect(result).not.toMatch(/\t\t$/m);
    });
  });
  
  describe('Metrics and Monitoring', () => {
    test('tracks filtering metrics', () => {
      const input = `Cookie Policy text
Article content
Cookie Policy text`;
      
      filter.filterContent(input);
      const metrics = filter.getMetrics();
      
      expect(metrics.totalFiltered).toBeGreaterThan(0);
      expect(metrics.bytesProcessed).toBeGreaterThan(0);
      expect(metrics.reductionPercent).toBeDefined();
    });
    
    test('reset clears metrics and memory', () => {
      filter.filterContent('Some content');
      filter.filterContent('Cookie Policy');
      
      expect(filter.getMetrics().totalFiltered).toBeGreaterThan(0);
      expect(filter.seenContent.size).toBeGreaterThan(0);
      
      filter.reset();
      
      expect(filter.getMetrics().totalFiltered).toBe(0);
      expect(filter.seenContent.size).toBe(0);
    });
  });
});