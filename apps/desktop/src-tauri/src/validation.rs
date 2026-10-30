use crate::{error, Result};
use serde_json::Value;
use std::collections::HashSet;

pub fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| error("INVALID_DATA", "Required text is missing."))
}
pub fn rows<'a>(v: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    v.get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| error("INVALID_DATA", "Required collection is missing."))
}
fn check(ok: bool, code: &str) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(error(
            code,
            "Data violates accounting storage integrity rules.",
        ))
    }
}
pub fn number(v: &Value, key: &str) -> Result<i64> {
    v.get(key)
        .and_then(Value::as_i64)
        .filter(|n| *n > 0 && *n < 9_007_199_254_740_991)
        .ok_or_else(|| error("INVALID_VERSION", "Expected a positive bounded revision."))
}
pub fn date(s: &str) -> Result<()> {
    let parts: Vec<_> = s.split('-').collect();
    let nums: Vec<u32> = parts.iter().filter_map(|p| p.parse().ok()).collect();
    let ok = s.len() == 10
        && parts.len() == 3
        && parts[0].len() == 4
        && parts[1].len() == 2
        && parts[2].len() == 2
        && s.bytes().all(|b| b.is_ascii_digit() || b == b'-')
        && nums.len() == 3;
    check(ok, "INVALID_DATE")?;
    let (y, m, d) = (nums[0], nums[1], nums[2]);
    let days = match m {
        2 => {
            if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    };
    check(y > 0 && d > 0 && d <= days, "INVALID_DATE")
}
fn range(v: &Value) -> Result<()> {
    let (start, end) = (text(v, "start")?, text(v, "end")?);
    date(start)?;
    date(end)?;
    if end < start {
        return Err(crate::Error {
            code: "INVALID_PERIOD_RANGE".into(),
            message: "End date must be on or after start date.".into(),
            field: Some("endDate".into()),
            retry_after: None,
        });
    }
    Ok(())
}
fn id(v: &Value, key: &str) -> Result<String> {
    let s = text(v, key)?;
    check(
        !s.is_empty()
            && s.len() <= 100
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_:. ".contains(&b))
            && !s.contains(' '),
        "INVALID_ID",
    )?;
    Ok(s.into())
}
fn unique(items: &[Value], key: &str) -> Result<()> {
    let mut ids = HashSet::new();
    for item in items {
        check(ids.insert(id(item, key)?), "DUPLICATE_ID")?;
    }
    Ok(())
}
fn scoped(v: &Value, tenant: &str, company: &str) -> Result<()> {
    check(
        text(v, "tenantId")? == tenant && text(v, "companyId")? == company,
        "SCOPE_MISMATCH",
    )
}
pub fn minor(v: &Value) -> Result<i64> {
    let s = v
        .as_str()
        .ok_or_else(|| error("INVALID_AMOUNT", "Amounts must be integer strings."))?;
    let n = s
        .parse::<i64>()
        .map_err(|_| error("INVALID_AMOUNT", "Amount exceeds supported bounds."))?;
    check(n > 0 && n.to_string() == s, "INVALID_AMOUNT")?;
    Ok(n)
}
pub fn validate(state: &Value, tenant: &str, company: &str) -> Result<()> {
    validate_inner(state, tenant, company, true)
}
pub fn validate_canonical(state: &Value, tenant: &str, company: &str) -> Result<()> {
    validate_inner(state, tenant, company, false)
}
fn validate_inner(state: &Value, tenant: &str, company: &str, local: bool) -> Result<()> {
    let config = &state["config"];
    scoped(&config["company"], tenant, company)?;
    id(&config["company"], "companyId")?;
    id(&config["company"], "tenantId")?;
    let c = &config["company"];
    let name = text(c, "name")?;
    check(!name.trim().is_empty() && name.len() <= 800, "INVALID_NAME")?;
    date(text(c, "booksFrom")?)?;
    let currency = &c["currency"];
    check(
        text(currency, "code")?.len() == 3
            && text(currency, "code")?
                .bytes()
                .all(|b| b.is_ascii_uppercase())
            && currency["scale"].as_u64().is_some_and(|n| n <= 6),
        "INVALID_CURRENCY",
    )?;
    number(state, "chartVersion")?;
    let years = rows(config, "years")?;
    let periods = rows(config, "periods")?;
    let groups = rows(config, "groups")?;
    let ledgers = rows(config, "ledgers")?;
    for collection in [years, periods, groups, ledgers] {
        unique(collection, "id")?;
        for item in collection {
            scoped(item, tenant, company)?;
        }
    }
    for ranges in [years, periods] {
        for (i, item) in ranges.iter().enumerate() {
            range(item)?;
            for other in ranges.iter().skip(i + 1) {
                check(
                    text(item, "end")? < text(other, "start")?
                        || text(other, "end")? < text(item, "start")?,
                    "OVERLAPPING_PERIODS",
                )?;
            }
        }
    }
    for p in periods {
        let y = years
            .iter()
            .find(|y| y["id"] == p["yearId"])
            .ok_or_else(|| error("PERIOD_OUTSIDE_YEAR", "Period must belong to its year."))?;
        check(
            text(p, "start")? >= text(y, "start")? && text(p, "end")? <= text(y, "end")?,
            "PERIOD_OUTSIDE_YEAR",
        )?;
        check(
            matches!(text(p, "status")?, "open" | "locked"),
            "INVALID_PERIOD_STATUS",
        )?;
        number(p, "version")?;
    }
    for group in groups {
        check(
            matches!(
                text(group, "nature")?,
                "asset" | "liability" | "equity" | "income" | "expense"
            ),
            "INVALID_NATURE",
        )?;
        let mut seen = HashSet::from([text(group, "id")?]);
        let mut current = group;
        while !current["parentId"].is_null() {
            let parent = text(current, "parentId")?;
            check(seen.insert(parent), "GROUP_CYCLE")?;
            current = groups
                .iter()
                .find(|g| g["id"] == parent)
                .ok_or_else(|| error("GROUP_NOT_FOUND", "Group parent does not exist."))?;
            check(current["nature"] == group["nature"], "NATURE_MISMATCH")?;
        }
    }
    for ledger in ledgers {
        let group = groups
            .iter()
            .find(|g| g["id"] == ledger["groupId"])
            .ok_or_else(|| error("GROUP_NOT_FOUND", "Ledger group does not exist."))?;
        check(
            matches!(text(ledger, "kind")?, "general" | "cash" | "bank"),
            "INVALID_KIND",
        )?;
        if ledger["kind"] == "cash" {
            check(group["nature"] == "asset", "INVALID_KIND")?;
        }
        if ledger["kind"] == "bank" {
            check(
                group["nature"] == "asset" || group["nature"] == "liability",
                "INVALID_KIND",
            )?;
        }
    }
    let entries = rows(state, "entries")?;
    unique(entries, "id")?;
    for e in entries {
        scoped(e, tenant, company)?;
        date(text(e, "date")?)?;
        let p = periods
            .iter()
            .find(|p| p["id"] == e["periodId"])
            .ok_or_else(|| error("PERIOD_NOT_FOUND", "Journal period does not exist."))?;
        check(
            e["yearId"] == p["yearId"]
                && text(e, "date")? >= text(p, "start")?
                && text(e, "date")? <= text(p, "end")?
                && text(e, "date")? >= text(c, "booksFrom")?,
            "DATE_OUTSIDE_PERIOD",
        )?;
        check(e["currency"] == c["currency"], "CURRENCY_MISMATCH")?;
        let lines = rows(e, "lines")?;
        check(lines.len() >= 2 && lines.len() <= 1000, "INVALID_LINES")?;
        let mut total = 0i128;
        let mut debit_liquid = false;
        let mut credit_liquid = false;
        let mut all_liquid = true;
        for line in lines {
            let ledger = ledgers
                .iter()
                .find(|l| l["id"] == line["ledgerId"])
                .ok_or_else(|| error("LEDGER_NOT_FOUND", "Journal ledger does not exist."))?;
            let group = groups
                .iter()
                .find(|g| g["id"] == ledger["groupId"])
                .unwrap();
            check(line["nature"] == group["nature"], "NATURE_MISMATCH")?;
            let amount = minor(&line["amount"])? as i128;
            let liquid = ledger["kind"] == "cash" || ledger["kind"] == "bank";
            all_liquid &= liquid;
            match text(line, "side")? {
                "debit" => {
                    total += amount;
                    debit_liquid |= liquid;
                }
                "credit" => {
                    total -= amount;
                    credit_liquid |= liquid;
                }
                _ => return Err(error("INVALID_SIDE", "Invalid journal side.")),
            }
        }
        check(total == 0, "UNBALANCED_JOURNAL")?;
        match text(e, "intent")? {
            "general" => {}
            "opening" => check(e["date"] == c["booksFrom"], "INVALID_OPENING_DATE")?,
            "payment" => check(credit_liquid && !debit_liquid, "INVALID_INTENT")?,
            "receipt" => check(debit_liquid && !credit_liquid, "INVALID_INTENT")?,
            "transfer" => check(all_liquid, "INVALID_INTENT")?,
            _ => return Err(error("INVALID_INTENT", "Invalid journal intent.")),
        }
        if !e["reverses"].is_null() {
            let original = entries
                .iter()
                .find(|o| o["id"] == e["reverses"])
                .ok_or_else(|| error("INVALID_REVERSAL", "Original is missing."))?;
            check(
                original["reverses"].is_null()
                    && original["id"] != e["id"]
                    && text(e, "date")? >= text(original, "date")?
                    && !text(e, "narration")?.trim().is_empty()
                    && entries
                        .iter()
                        .filter(|other| other["reverses"] == e["reverses"])
                        .count()
                        == 1,
                "INVALID_REVERSAL",
            )?;
            let prior = rows(original, "lines")?;
            check(
                prior.len() == lines.len()
                    && prior.iter().zip(lines).all(|(a, b)| {
                        a["ledgerId"] == b["ledgerId"]
                            && a["amount"] == b["amount"]
                            && a["side"] != b["side"]
                    }),
                "INVALID_REVERSAL",
            )?;
        }
    }
    let receipts = rows(state, "receipts")?;
    unique(receipts, "commandId")?;
    let audit = rows(state, "audit")?;
    check(receipts.len() == audit.len(), "INCOMPLETE_POSTING")?;
    for r in receipts {
        scoped(r, tenant, company)?;
        check(
            audit
                .iter()
                .filter(|a| a["commandId"] == r["commandId"])
                .count()
                == 1,
            "INCOMPLETE_POSTING",
        )?;
    }
    for a in audit {
        scoped(a, tenant, company)?;
        check(!local || a["actorId"] == "local-owner", "FORBIDDEN")?;
    }
    for entry in entries {
        check(
            receipts.iter().any(|r| r["result"] == *entry)
                && (!local || entry["actorId"] == "local-owner"),
            "INCOMPLETE_POSTING",
        )?;
    }
    let drafts = rows(state, "drafts")?;
    unique(drafts, "id")?;
    for draft in drafts {
        scoped(draft, tenant, company)?;
        number(draft, "version")?;
    }
    Ok(())
}

pub fn transition(before: &Value, after: &Value, tenant: &str, company: &str) -> Result<()> {
    validate(after, tenant, company)?;
    check(
        before["config"]["company"] == after["config"]["company"],
        "COMPANY_IMMUTABLE",
    )?;
    let changed = before["config"]["groups"] != after["config"]["groups"]
        || before["config"]["ledgers"] != after["config"]["ledgers"];
    check(
        number(after, "chartVersion")? == number(before, "chartVersion")? + i64::from(changed),
        "VERSION_CONFLICT",
    )?;
    for key in ["entries", "receipts", "audit"] {
        let old = rows(before, key)?;
        let new = rows(after, key)?;
        check(new.starts_with(old), "IMMUTABLE_HISTORY")?;
    }
    if before != after {
        check(
            rows(after, "receipts")?.len() == rows(before, "receipts")?.len() + 1
                && rows(after, "audit")?.len() == rows(before, "audit")?.len() + 1,
            "INCOMPLETE_POSTING",
        )?;
        let event = rows(after, "audit")?.last().unwrap();
        let receipt = rows(after, "receipts")?.last().unwrap();
        let action = text(event, "action")?;
        check(
            matches!(
                action,
                "post"
                    | "reverse"
                    | "post-draft"
                    | "save-draft"
                    | "period-status"
                    | "replace-chart"
                    | "extend-calendar"
            ),
            "UNSUPPORTED_OPERATION",
        )?;
        if action != "extend-calendar" {
            check(
                before["config"]["years"] == after["config"]["years"],
                "CALENDAR_IMMUTABLE",
            )?;
        } else {
            check(
                !text(event, "reason")?.trim().is_empty() && receipt["result"] == after["config"],
                "REASON_REQUIRED",
            )?;
            for key in ["years", "periods"] {
                let old = rows(&before["config"], key)?;
                let next = rows(&after["config"], key)?;
                check(
                    next.len() == old.len() + 1 && next.starts_with(old),
                    "CALENDAR_IMMUTABLE",
                )?;
            }
            let year = rows(&after["config"], "years")?.last().unwrap();
            let p = rows(&after["config"], "periods")?.last().unwrap();
            check(
                p["yearId"] == year["id"] && p["status"] == "open" && p["version"] == 1,
                "INVALID_PERIOD",
            )?;
        }
        if action != "replace-chart" {
            check(
                before["config"]["groups"] == after["config"]["groups"]
                    && before["config"]["ledgers"] == after["config"]["ledgers"],
                "INVALID_MUTATION",
            )?;
        } else {
            check(receipt["result"] == after["config"], "INCOMPLETE_POSTING")?;
        }
        if !matches!(action, "period-status" | "extend-calendar") {
            check(
                before["config"]["periods"] == after["config"]["periods"],
                "INVALID_MUTATION",
            )?;
        } else if action == "period-status" {
            check(!text(event, "reason")?.trim().is_empty(), "REASON_REQUIRED")?;
            let old = rows(&before["config"], "periods")?;
            let next = rows(&after["config"], "periods")?;
            check(old.len() == next.len(), "CALENDAR_IMMUTABLE")?;
            let mut changes = 0;
            for (a, b) in old.iter().zip(next) {
                let mut allowed = a.clone();
                allowed["status"] = b["status"].clone();
                allowed["version"] = b["version"].clone();
                check(allowed == *b, "REFERENCED_PERIOD_IMMUTABLE")?;
                if a != b {
                    changes += 1;
                    check(receipt["result"] == *b, "INCOMPLETE_POSTING")?;
                }
            }
            check(changes == 1, "INVALID_MUTATION")?;
        }
        if matches!(action, "post" | "reverse" | "post-draft") {
            check(
                rows(after, "entries")?.len() == rows(before, "entries")?.len() + 1,
                "INCOMPLETE_POSTING",
            )?;
            let posted = rows(after, "entries")?.last().unwrap();
            check(receipt["result"] == *posted, "INCOMPLETE_POSTING")?;
            check(
                (action == "reverse") == !posted["reverses"].is_null(),
                "INVALID_REVERSAL",
            )?;
        } else {
            check(before["entries"] == after["entries"], "INVALID_MUTATION")?;
        }
        if !matches!(action, "save-draft" | "post-draft") {
            check(before["drafts"] == after["drafts"], "INVALID_MUTATION")?;
        }
    }
    for draft in rows(before, "drafts")?
        .iter()
        .filter(|d| d["status"] == "posted")
    {
        check(
            rows(after, "drafts")?.contains(draft),
            "POSTED_DRAFT_IMMUTABLE",
        )?;
    }
    let old_entries = rows(before, "entries")?;
    for e in rows(after, "entries")?.iter().skip(old_entries.len()) {
        let p = rows(&after["config"], "periods")?
            .iter()
            .find(|p| p["id"] == e["periodId"])
            .unwrap();
        check(
            p["status"] == "open" && p["version"] == e["periodVersion"],
            "PERIOD_LOCKED",
        )?;
        if !e["reverses"].is_null() {
            check(
                old_entries.iter().any(|o| o["id"] == e["reverses"]),
                "INVALID_REVERSAL",
            )?;
        }
    }
    for entry in old_entries {
        for (key, refkey) in [("periods", "periodId"), ("years", "yearId")] {
            let old = rows(&before["config"], key)?
                .iter()
                .find(|r| r["id"] == entry[refkey])
                .unwrap();
            let new = rows(&after["config"], key)?
                .iter()
                .find(|r| r["id"] == entry[refkey])
                .ok_or_else(|| {
                    error(
                        "REFERENCED_PERIOD_IMMUTABLE",
                        "Posted period cannot be removed.",
                    )
                })?;
            check(
                old["start"] == new["start"]
                    && old["end"] == new["end"]
                    && old["yearId"] == new["yearId"],
                "REFERENCED_PERIOD_IMMUTABLE",
            )?;
        }
        for line in rows(entry, "lines")? {
            let old = rows(&before["config"], "ledgers")?
                .iter()
                .find(|l| l["id"] == line["ledgerId"])
                .unwrap();
            let new = rows(&after["config"], "ledgers")?
                .iter()
                .find(|l| l["id"] == line["ledgerId"])
                .unwrap();
            check(
                old["groupId"] == new["groupId"] && old["kind"] == new["kind"],
                "REFERENCED_MASTER_IMMUTABLE",
            )?;
            let mut group_id = old["groupId"].clone();
            while !group_id.is_null() {
                let prior = rows(&before["config"], "groups")?
                    .iter()
                    .find(|g| g["id"] == group_id)
                    .unwrap();
                let next = rows(&after["config"], "groups")?
                    .iter()
                    .find(|g| g["id"] == group_id)
                    .ok_or_else(|| {
                        error(
                            "REFERENCED_MASTER_IMMUTABLE",
                            "Cannot remove a posted group.",
                        )
                    })?;
                check(
                    prior["parentId"] == next["parentId"] && prior["nature"] == next["nature"],
                    "REFERENCED_MASTER_IMMUTABLE",
                )?;
                group_id = prior["parentId"].clone();
            }
        }
    }
    for p in rows(&after["config"], "periods")? {
        if let Some(old) = rows(&before["config"], "periods")?
            .iter()
            .find(|o| o["id"] == p["id"])
        {
            if p != old {
                check(
                    number(p, "version")? == number(old, "version")? + 1,
                    "VERSION_CONFLICT",
                )?;
            }
        }
    }
    Ok(())
}
