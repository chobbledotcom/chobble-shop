#!/usr/bin/env node
/**
 * Script to add unique SKUs to product options that are missing them.
 * SKUs are 6-character random alphanumeric strings.
 *
 * Usage: node scripts/add-skus.js [--dry-run]
 */

const fs = require("fs");
const path = require("path");

const PRODUCTS_DIR = "products";
const SKU_LENGTH = 6;
const SKU_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Simple frontmatter parser (avoids gray-matter dependency)
 */
const parseFrontmatter = (content) => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const yamlStr = match[1];
  const body = match[2];

  // Parse YAML manually for our simple use case
  const data = parseYaml(yamlStr);
  return { data, body };
};

/**
 * Simple YAML parser for product frontmatter
 */
const parseYaml = (yamlStr) => {
  const lines = yamlStr.split("\n");
  const result = {};
  let currentKey = null;
  let currentArray = null;
  let currentObject = null;

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Array item with object properties
    if (line.match(/^  - /)) {
      if (currentArray) {
        currentObject = {};
        currentArray.push(currentObject);
        const content = line.replace(/^  - /, "");
        if (content.includes(": ")) {
          const [key, ...valueParts] = content.split(": ");
          currentObject[key.trim()] = parseValue(valueParts.join(": "));
        }
      }
    }
    // Object property within array item
    else if (line.match(/^    \w/) && currentObject) {
      const [key, ...valueParts] = line.trim().split(": ");
      currentObject[key.trim()] = parseValue(valueParts.join(": "));
    }
    // Top-level key
    else if (line.match(/^\w/)) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > -1) {
        currentKey = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        if (value === "") {
          // Could be an array or object
          result[currentKey] = [];
          currentArray = result[currentKey];
          currentObject = null;
        } else {
          result[currentKey] = parseValue(value);
          currentArray = null;
          currentObject = null;
        }
      }
    }
  }

  return result;
};

const parseValue = (value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
};

/**
 * Serialize data back to YAML frontmatter
 */
const stringifyFrontmatter = (data, body) => {
  let yaml = "---\n";

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      yaml += `${key}:\n`;
      for (const item of value) {
        if (typeof item === "object") {
          const entries = Object.entries(item);
          yaml += `  - ${entries[0][0]}: ${formatValue(entries[0][1])}\n`;
          for (let i = 1; i < entries.length; i++) {
            yaml += `    ${entries[i][0]}: ${formatValue(entries[i][1])}\n`;
          }
        } else {
          yaml += `  - ${formatValue(item)}\n`;
        }
      }
    } else {
      yaml += `${key}: ${formatValue(value)}\n`;
    }
  }

  yaml += "---\n";
  return yaml + body;
};

const formatValue = (value) => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value.toString();
  if (value === null) return "null";
  return String(value);
};

/**
 * Generate a random SKU of specified length
 */
const generateSku = (length = SKU_LENGTH) => {
  let sku = "";
  for (let i = 0; i < length; i++) {
    sku += SKU_CHARS.charAt(Math.floor(Math.random() * SKU_CHARS.length));
  }
  return sku;
};

/**
 * Collect all existing SKUs from all products
 */
const collectExistingSkus = (productsDir) => {
  const skus = new Set();
  const files = fs.readdirSync(productsDir).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const filePath = path.join(productsDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    const { data } = parseFrontmatter(content);

    if (data.options && Array.isArray(data.options)) {
      for (const option of data.options) {
        if (option.sku) {
          skus.add(option.sku);
        }
      }
    }
  }

  return skus;
};

/**
 * Generate a unique SKU that doesn't exist in the set
 */
const generateUniqueSku = (existingSkus) => {
  let sku;
  let attempts = 0;
  const maxAttempts = 1000;

  do {
    sku = generateSku();
    attempts++;
    if (attempts >= maxAttempts) {
      throw new Error("Could not generate unique SKU after maximum attempts");
    }
  } while (existingSkus.has(sku));

  existingSkus.add(sku);
  return sku;
};

/**
 * Process a single product file and add SKUs to options missing them
 * Returns true if the file was modified
 */
const processProductFile = (filePath, existingSkus, dryRun = false) => {
  const content = fs.readFileSync(filePath, "utf8");
  const { data, body } = parseFrontmatter(content);

  if (!data.options || !Array.isArray(data.options)) {
    return { modified: false, skusAdded: 0 };
  }

  let modified = false;
  let skusAdded = 0;

  for (const option of data.options) {
    if (!option.sku) {
      option.sku = generateUniqueSku(existingSkus);
      modified = true;
      skusAdded++;
    }
  }

  if (modified && !dryRun) {
    const newContent = stringifyFrontmatter(data, body);
    fs.writeFileSync(filePath, newContent);
  }

  return { modified, skusAdded };
};

/**
 * Main function to process all product files
 */
const addSkusToProducts = (dryRun = false) => {
  const productsDir = path.join(process.cwd(), PRODUCTS_DIR);

  if (!fs.existsSync(productsDir)) {
    console.error(`Products directory not found: ${productsDir}`);
    process.exit(1);
  }

  // Collect existing SKUs first
  const existingSkus = collectExistingSkus(productsDir);
  console.log(`Found ${existingSkus.size} existing SKUs`);

  const files = fs.readdirSync(productsDir).filter((f) => f.endsWith(".md"));
  let totalModified = 0;
  let totalSkusAdded = 0;

  for (const file of files) {
    const filePath = path.join(productsDir, file);
    const { modified, skusAdded } = processProductFile(
      filePath,
      existingSkus,
      dryRun
    );

    if (modified) {
      totalModified++;
      totalSkusAdded += skusAdded;
      console.log(
        `${dryRun ? "[DRY RUN] Would update" : "Updated"} ${file}: added ${skusAdded} SKU(s)`
      );
    }
  }

  console.log(
    `\n${dryRun ? "[DRY RUN] Would modify" : "Modified"} ${totalModified} file(s), added ${totalSkusAdded} SKU(s)`
  );

  return { totalModified, totalSkusAdded };
};

// CLI handling
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

if (dryRun) {
  console.log("Running in dry-run mode (no files will be modified)\n");
}

addSkusToProducts(dryRun);
