import { Router } from "express";
import { all, get, run, saveDatabase } from "../database/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { normalizeTowerMaxFloors } from "../utils/towerTaskConfig.js";

const router = Router();

router.use(authMiddleware);

function normalizeSettingsPayload(settings = {}) {
  const next = { ...(settings || {}) };
  next.towerMaxFloors = normalizeTowerMaxFloors(next.towerMaxFloors, 10);
  next.weirdTowerMaxFloors = normalizeTowerMaxFloors(
    next.weirdTowerMaxFloors ?? next.towerMaxFloors,
    10,
  );
  return next;
}

export function normalizeHistoricalBatchTowerSettings(settings = {}) {
  const next = { ...(settings || {}) };

  if (Object.prototype.hasOwnProperty.call(next, "towerMaxFloors")) {
    next.towerMaxFloors = normalizeTowerMaxFloors(next.towerMaxFloors, 10);
  }

  if (Object.prototype.hasOwnProperty.call(next, "weirdTowerMaxFloors")) {
    next.weirdTowerMaxFloors = normalizeTowerMaxFloors(next.weirdTowerMaxFloors, 10);
  }

  return next;
}

function parseSettingsJson(settingsJson) {
  if (!settingsJson) {
    return {};
  }
  try {
    return normalizeSettingsPayload(JSON.parse(settingsJson));
  } catch {
    return {};
  }
}

export async function clampHistoricalBatchTowerSettings() {
  const targets = [
    { table: "account_batch_settings", idColumn: "account_id" },
    { table: "batch_task_templates", idColumn: "id" },
  ];
  const details = [];
  let updated = 0;

  for (const target of targets) {
    const rows = all(`SELECT ${target.idColumn} AS id, settings_json FROM ${target.table}`);
    rows.forEach((row) => {
      if (!row.settings_json) {
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(row.settings_json);
      } catch {
        return;
      }
      const normalized = normalizeHistoricalBatchTowerSettings(parsed);
      if (JSON.stringify(parsed) === JSON.stringify(normalized)) {
        return;
      }
      run(
        `UPDATE ${target.table}
            SET settings_json = ?, updated_at = CURRENT_TIMESTAMP
          WHERE ${target.idColumn} = ?`,
        [JSON.stringify(normalized), row.id],
      );
      updated += 1;
      details.push({ table: target.table, id: row.id });
    });
  }

  if (updated > 0) {
    await saveDatabase();
  }

  return { updated, details };
}

router.get("/account-settings", (req, res) => {
  try {
    const rows = all(
      `SELECT abs.account_id, abs.template_id, abs.settings_json, abs.created_at, abs.updated_at, ga.name AS account_name
       FROM account_batch_settings abs
       JOIN game_accounts ga ON ga.id = abs.account_id
       WHERE ga.user_id = ?
       ORDER BY ga.created_at DESC`,
      [req.user.userId],
    );

    res.json({
      success: true,
      data: rows.map((row) => ({
        accountId: row.account_id,
        accountName: row.account_name,
        templateId: row.template_id || null,
        settings: parseSettingsJson(row.settings_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error("获取批量账号设置失败:", error);
    res.status(500).json({ success: false, error: "获取批量账号设置失败" });
  }
});

router.put("/account-settings/:accountId", (req, res) => {
  try {
    const { accountId } = req.params;
    const { settings, templateId = null } = req.body || {};

    const account = get(
      "SELECT id FROM game_accounts WHERE id = ? AND user_id = ?",
      [accountId, req.user.userId],
    );

    if (!account) {
      return res.status(404).json({ success: false, error: "账号不存在" });
    }

    let normalizedTemplateId = templateId == null || templateId === "" ? null : Number(templateId);
    if (normalizedTemplateId != null) {
      const template = get(
        "SELECT id FROM batch_task_templates WHERE id = ? AND user_id = ?",
        [normalizedTemplateId, req.user.userId],
      );
      if (!template) {
        return res.status(404).json({ success: false, error: "模板不存在" });
      }
    }

    const settingsJson = JSON.stringify(normalizeSettingsPayload(settings));
    const existing = get("SELECT id FROM account_batch_settings WHERE account_id = ?", [accountId]);

    if (existing) {
      run(
        `UPDATE account_batch_settings
         SET template_id = ?, settings_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE account_id = ?`,
        [normalizedTemplateId, settingsJson, accountId],
      );
    } else {
      run(
        `INSERT INTO account_batch_settings (account_id, template_id, settings_json)
         VALUES (?, ?, ?)`,
        [accountId, normalizedTemplateId, settingsJson],
      );
    }

    const saved = get(
      `SELECT abs.account_id, abs.template_id, abs.settings_json, abs.created_at, abs.updated_at, ga.name AS account_name
       FROM account_batch_settings abs
       JOIN game_accounts ga ON ga.id = abs.account_id
       WHERE abs.account_id = ?`,
      [accountId],
    );

    res.json({
      success: true,
      message: "账号设置保存成功",
      data: {
        accountId: saved.account_id,
        accountName: saved.account_name,
        templateId: saved.template_id || null,
        settings: parseSettingsJson(saved.settings_json),
        createdAt: saved.created_at,
        updatedAt: saved.updated_at,
      },
    });
  } catch (error) {
    console.error("保存批量账号设置失败:", error);
    res.status(500).json({ success: false, error: "保存批量账号设置失败" });
  }
});

router.get("/templates", (req, res) => {
  try {
    const rows = all(
      `SELECT id, name, settings_json, created_at, updated_at
       FROM batch_task_templates
       WHERE user_id = ?
       ORDER BY updated_at DESC, id DESC`,
      [req.user.userId],
    );

    res.json({
      success: true,
      data: rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        settings: parseSettingsJson(row.settings_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error("获取批量任务模板失败:", error);
    res.status(500).json({ success: false, error: "获取批量任务模板失败" });
  }
});

router.post("/templates", (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const settings = normalizeSettingsPayload(req.body?.settings || {});

    if (!name) {
      return res.status(400).json({ success: false, error: "模板名称不能为空" });
    }

    const result = run(
      `INSERT INTO batch_task_templates (user_id, name, settings_json) VALUES (?, ?, ?)`,
      [req.user.userId, name, JSON.stringify(settings)],
    );

    const template = get(
      `SELECT id, name, settings_json, created_at, updated_at
       FROM batch_task_templates WHERE id = ? AND user_id = ?`,
      [result.lastInsertRowid, req.user.userId],
    );

    res.status(201).json({
      success: true,
      message: "模板创建成功",
      data: {
        id: String(template.id),
        name: template.name,
        settings: parseSettingsJson(template.settings_json),
        createdAt: template.created_at,
        updatedAt: template.updated_at,
      },
    });
  } catch (error) {
    console.error("创建批量任务模板失败:", error);
    res.status(500).json({ success: false, error: "创建批量任务模板失败" });
  }
});

router.put("/templates/:id", (req, res) => {
  try {
    const { id } = req.params;
    const name = req.body?.name !== undefined ? String(req.body.name || "").trim() : undefined;
    const settings = req.body?.settings;

    const existing = get(
      "SELECT id FROM batch_task_templates WHERE id = ? AND user_id = ?",
      [id, req.user.userId],
    );

    if (!existing) {
      return res.status(404).json({ success: false, error: "模板不存在" });
    }

    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) {
      if (!name) {
        return res.status(400).json({ success: false, error: "模板名称不能为空" });
      }
      updateFields.push("name = ?");
      updateValues.push(name);
    }

    if (settings !== undefined) {
      updateFields.push("settings_json = ?");
      updateValues.push(JSON.stringify(normalizeSettingsPayload(settings)));
    }

    updateFields.push("updated_at = CURRENT_TIMESTAMP");
    updateValues.push(id, req.user.userId);

    run(
      `UPDATE batch_task_templates SET ${updateFields.join(", ")} WHERE id = ? AND user_id = ?`,
      updateValues,
    );

    const template = get(
      `SELECT id, name, settings_json, created_at, updated_at
       FROM batch_task_templates WHERE id = ? AND user_id = ?`,
      [id, req.user.userId],
    );

    res.json({
      success: true,
      message: "模板更新成功",
      data: {
        id: String(template.id),
        name: template.name,
        settings: parseSettingsJson(template.settings_json),
        createdAt: template.created_at,
        updatedAt: template.updated_at,
      },
    });
  } catch (error) {
    console.error("更新批量任务模板失败:", error);
    res.status(500).json({ success: false, error: "更新批量任务模板失败" });
  }
});

router.delete("/templates/:id", (req, res) => {
  try {
    const { id } = req.params;
    const template = get(
      "SELECT id FROM batch_task_templates WHERE id = ? AND user_id = ?",
      [id, req.user.userId],
    );

    if (!template) {
      return res.status(404).json({ success: false, error: "模板不存在" });
    }

    run(
      `UPDATE account_batch_settings
       SET template_id = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE template_id = ?
         AND account_id IN (SELECT id FROM game_accounts WHERE user_id = ?)`,
      [id, req.user.userId],
    );
    run("DELETE FROM batch_task_templates WHERE id = ? AND user_id = ?", [id, req.user.userId]);

    res.json({ success: true, message: "模板删除成功" });
  } catch (error) {
    console.error("删除批量任务模板失败:", error);
    res.status(500).json({ success: false, error: "删除批量任务模板失败" });
  }
});

export default router;
