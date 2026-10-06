# Backend Bugs to Fix - 17 Test Failures

**Status:** Deferred until after Flutter data layer is complete
**Priority:** HIGH - Must fix before production
**Estimated Time:** 2-3 hours

## Test Status
- ✅ **66 tests passing** (83% of non-skipped tests)
- ❌ **17 tests failing** (real bugs, not test issues)
- ⏭️ **23 tests skipped** (RLS tests)

---

## Bug #1: Schema Cache Issue - `owner_id` Column Not Found

### Error
```
"Could not find the 'owner_id' column of 'workspaces' in the schema cache"
```

### Location
- Supabase PostgREST schema cache
- Affects: Stage 5 workspace queries

### Possible Causes
1. PostgREST schema cache not refreshed after migrations
2. RLS policies referencing wrong column name
3. Migration didn't create `owner_id` column properly

### Fix Steps
1. Check if `owner_id` column exists in `workspaces` table (Supabase dashboard)
2. Run `NOTIFY pgrst, 'reload schema'` in Supabase SQL editor to refresh cache
3. Check RLS policies for typos in column names
4. Verify migration 002-workspaces.sql created all columns

### Files to Check
- `BACKEND/migrations/002-workspaces.sql`
- Supabase RLS policies for `workspaces` table

---

## Bug #2: Permission/Role Checking Bugs (Stage 5)

### Failing Tests
1. ❌ "should list invite codes (admin)" - got 403 Forbidden
2. ❌ "should revoke invite code (admin)" - got 403 Forbidden
3. ❌ "should list workspace members" - got 403 Forbidden
4. ❌ "should reject removing last admin" - Expected 'LAST_ADMIN', got 'NOT_A_MEMBER'

### Root Cause
Role/permission checking logic is incorrectly denying access to valid requests

### Fix Steps
1. Review `src/middleware/workspace.js` - loadWorkspace function
2. Check how member role is determined
3. Verify admin role checks in invite code routes
4. Fix "last admin" detection logic

### Files to Fix
- `src/middleware/workspace.js` - Role checking
- `src/routes/workspaces.js` - Invite code endpoints
- `src/routes/workspaces.js` - Member list endpoint
- Look for role validation in workspace member removal

### Expected Behavior
- Workspace admins should be able to:
  - List invite codes
  - Revoke invite codes
  - List workspace members
- System should detect and prevent removing the last admin

---

## Bug #3: RequestID Type Mismatch (Stage 5)

### Error
```javascript
Expected: "string"
Received: "number"
```

### Location
Test: "should include requestId in all error responses"
File: `tests/stage5-workspaces.test.js:411`

### Root Cause
Error handler is setting `requestId` as a number instead of string

### Fix Steps
1. Find where `requestId` is set in error responses
2. Convert to string: `String(req.id)` or `req.id.toString()`
3. Test that error responses have string requestId

### Files to Fix
- `src/middleware/errorHandler.js` (likely location)
- `src/app.js` (if error handling is there)

### Quick Fix
```javascript
// Change from:
requestId: req.id

// To:
requestId: String(req.id)
```

---

## Bug #4: Additional Stage 2 Failures

### Status
Need to investigate - not shown in last test output

### Fix Steps
1. Run `npm test tests/stage2-foundation.test.js` to see specific failures
2. Document failures here
3. Fix based on error messages

---

## Testing Plan

### Step 1: Run Individual Test Files
```bash
npm test tests/stage2-foundation.test.js
npm test tests/stage5-workspaces.test.js
```

### Step 2: Fix Bugs One by One
1. Start with Bug #3 (easiest - requestId type)
2. Then Bug #2 (permission logic)
3. Then Bug #1 (schema cache)
4. Finally Bug #4 (stage 2 issues)

### Step 3: Verify Full Test Suite
```bash
npm test
```

### Success Criteria
- All 83 non-skipped tests passing (currently 66/83)
- 0 failures
- 23 skipped (RLS tests - OK to skip)

---

## When to Fix

**BEFORE PRODUCTION:** ✅ Must fix
**BEFORE FLUTTER TESTING:** ❌ Can defer

These bugs don't block Flutter development because:
- Core endpoints work (tasks, workspaces, labels, sync)
- Auth works (real Supabase tokens)
- The failures are edge cases (invite codes, member management, error format)

**Recommended:** Fix these bugs AFTER Flutter data layer is working and tested.

---

## Tracking

- [ ] Bug #1: Schema cache issue
- [ ] Bug #2: Permission/role checks  
- [ ] Bug #3: RequestID type mismatch
- [ ] Bug #4: Stage 2 failures (TBD)
- [ ] Full test suite passing (83/83 non-skipped)

---

## Notes

- Test database: `https://raqxkjvpoowaiiqnlzqv.supabase.co`
- Tests use real Supabase auth (no mocks!)
- Run with `npm test` (automatically sets NODE_ENV=test)
- Clean test users created/deleted in beforeAll/afterAll
