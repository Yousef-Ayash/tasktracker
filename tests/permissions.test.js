import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  visibleTasksClause,
  canEditContent,
  canChangeStatus,
  canChangeLogistics,
} from '../src/middleware/permissions.js';

// In-memory DB seeded with the same schema, so canChangeLogistics (which
// looks up manager_id) behaves exactly as it does in production.
function makeTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const schemaPath = path.join(import.meta.dirname, '../src/db/schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));

  db.prepare('INSERT INTO users (id, username, password, role_id, manager_id) VALUES (1, ?, ?, 1, NULL)').run('admin', 'x');
  db.prepare('INSERT INTO users (id, username, password, role_id, manager_id) VALUES (2, ?, ?, 2, NULL)').run('sara', 'x'); // manager
  db.prepare('INSERT INTO users (id, username, password, role_id, manager_id) VALUES (3, ?, ?, 3, 2)').run('ali', 'x');    // reports to sara
  db.prepare('INSERT INTO users (id, username, password, role_id, manager_id) VALUES (4, ?, ?, 3, NULL)').run('ben', 'x'); // no manager

  return db;
}

const admin = { id: 1, role: 'admin' };
const sara = { id: 2, role: 'manager' };
const ali = { id: 3, role: 'user' };
const ben = { id: 4, role: 'user' };

test('canChangeLogistics: manager can act on their report\'s task', () => {
  const db = makeTestDb();
  const task = { id: 1, created_by: ali.id };
  assert.equal(canChangeLogistics(task, sara, [ali.id], db), true);
});

test('canChangeLogistics: unrelated user cannot act on someone else\'s task', () => {
  const db = makeTestDb();
  const task = { id: 1, created_by: ali.id };
  assert.equal(canChangeLogistics(task, ben, [ali.id], db), false);
});

test('canChangeLogistics: creator always can, regardless of role', () => {
  const db = makeTestDb();
  const task = { id: 1, created_by: ali.id };
  assert.equal(canChangeLogistics(task, ali, [ali.id], db), true);
});

test('canChangeLogistics: admin always can', () => {
  const db = makeTestDb();
  const task = { id: 1, created_by: ali.id };
  assert.equal(canChangeLogistics(task, admin, [ali.id], db), true);
});

test('canChangeLogistics: manager of a DIFFERENT user cannot act on this task', () => {
  const db = makeTestDb();
  // ben has no manager, so sara should not be able to touch ben's task
  const task = { id: 1, created_by: ben.id };
  assert.equal(canChangeLogistics(task, sara, [ben.id], db), false);
});

test('canChangeStatus: any current assignee can change status', () => {
  const task = { id: 1, created_by: ben.id, status: 'pending' };
  assert.equal(canChangeStatus(task, ali, [ali.id, ben.id]), true);
});

test('canChangeStatus: a non-assignee, non-creator cannot change status', () => {
  const task = { id: 1, created_by: ben.id, status: 'pending' };
  const stranger = { id: 99, role: 'user' };
  assert.equal(canChangeStatus(task, stranger, [ali.id, ben.id]), false);
});

test('canEditContent: only the creator or admin', () => {
  const task = { id: 1, created_by: ali.id };
  assert.equal(canEditContent(task, ali), true);
  assert.equal(canEditContent(task, admin), true);
  assert.equal(canEditContent(task, sara), false); // manager, but not creator
});

test('visibleTasksClause: admin sees everything (no scoping filter)', () => {
  const { where, params } = visibleTasksClause(admin);
  assert.equal(where, 'deleted_at IS NULL');
  assert.deepEqual(params, []);
});

test('visibleTasksClause: manager clause includes reports-to check', () => {
  const { where, params } = visibleTasksClause(sara);
  assert.match(where, /manager_id = \?/);
  assert.deepEqual(params, [sara.id, sara.id, sara.id]);
});

test('visibleTasksClause: user clause has no reports-to check at all', () => {
  const { where, params } = visibleTasksClause(ali);
  assert.doesNotMatch(where, /manager_id/);
  assert.deepEqual(params, [ali.id, ali.id]);
});
