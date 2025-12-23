const fs = require("fs");
const path = require("path");

const APPROVALS_FILENAME = "approvals.json";

const approvalsCache = new Map();

function findApprovalsFile(startDir) {
  let currentDir = startDir;
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const approvalsPath = path.join(currentDir, APPROVALS_FILENAME);
    if (fs.existsSync(approvalsPath)) {
      return approvalsPath;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

function loadApprovalsFile(approvalsPath) {
  try {
    const stats = fs.statSync(approvalsPath);
    const cached = approvalsCache.get(approvalsPath);

    if (cached && cached.mtime.getTime() === stats.mtime.getTime()) {
      return cached.approvals;
    }

    const content = fs.readFileSync(approvalsPath, "utf8");
    const approvals = JSON.parse(content);

    approvalsCache.set(approvalsPath, {
      approvals,
      mtime: stats.mtime,
    });

    return approvals;
  } catch (error) {
    console.error(
      `[eslint-plugin-exceptions] Error loading ${approvalsPath}:`,
      error.message
    );
    return null;
  }
}

function getApprovalsForFile(filePath) {
  const fileDir = path.dirname(filePath);
  const approvalsPath = findApprovalsFile(fileDir);

  if (!approvalsPath) {
    return { approvals: null, approvalsDir: null };
  }

  const approvals = loadApprovalsFile(approvalsPath);
  const approvalsDir = path.dirname(approvalsPath);

  return { approvals, approvalsDir };
}

function getRelativePath(filePath, approvalsDir) {
  return path.relative(approvalsDir, filePath);
}

function getAllowedExceptions(approvals, ruleName, relativePath) {
  if (!approvals || !approvals[ruleName]) {
    return 0;
  }

  const ruleApprovals = approvals[ruleName];

  if (typeof ruleApprovals[relativePath] === "number") {
    return ruleApprovals[relativePath];
  }

  const normalizedPath = relativePath.replace(/\\/g, "/");
  if (typeof ruleApprovals[normalizedPath] === "number") {
    return ruleApprovals[normalizedPath];
  }

  return 0;
}

function clearCache() {
  approvalsCache.clear();
}

module.exports = {
  findApprovalsFile,
  loadApprovalsFile,
  getApprovalsForFile,
  getRelativePath,
  getAllowedExceptions,
  clearCache,
  APPROVALS_FILENAME,
};
