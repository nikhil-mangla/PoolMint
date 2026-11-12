import React, { useState } from 'react';
import { X, Plus, Trash2, ShieldCheck } from 'lucide-react';
import { Trip, TripMember } from '../types/treasury';
import { fromPaise, toPaise } from '../utils/accounting';

interface TripModalProps {
  existingTrip?: Trip | null;
  onClose: () => void;
  onSaveTrip: (trip: Trip) => Promise<void>;
  onDeleteTrip?: (tripId: string) => Promise<void>;
}

const AVATAR_COLORS = [
  '#059669',
  '#2563EB',
  '#7C3AED',
  '#D97706',
  '#DC2626',
  '#0891B2',
  '#4F46E5',
  '#DB2777',
];

export const TripModal: React.FC<TripModalProps> = ({
  existingTrip,
  onClose,
  onSaveTrip,
  onDeleteTrip,
}) => {
  const [name, setName] = useState(existingTrip?.name || '');
  const [destination, setDestination] = useState(existingTrip?.destination || '');
  const [startDate, setStartDate] = useState(
    existingTrip?.startDate || new Date().toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState(
    existingTrip?.endDate || new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
  );
  const [currency, setCurrency] = useState(existingTrip?.currency || 'INR');
  const [budgetInput, setBudgetInput] = useState(
    existingTrip ? String(fromPaise(existingTrip.budgetPaise)) : '30000'
  );
  const [description, setDescription] = useState(existingTrip?.description || '');
  const [allowNegativePool, setAllowNegativePool] = useState(
    existingTrip?.allowNegativePool || false
  );
  const [members, setMembers] = useState<TripMember[]>(
    existingTrip?.members || [
      { id: 'mem-1', name: 'Rahul', role: 'TREASURER', avatarColor: '#059669' },
      { id: 'mem-2', name: 'Aman', role: 'MEMBER', avatarColor: '#2563EB' },
      { id: 'mem-3', name: 'Nikhil', role: 'ADMIN', avatarColor: '#7C3AED' },
      { id: 'mem-4', name: 'Rohan', role: 'MEMBER', avatarColor: '#D97706' },
      { id: 'mem-5', name: 'Karan', role: 'MEMBER', avatarColor: '#DC2626' },
    ]
  );
  const [treasurerMemberId, setTreasurerMemberId] = useState(
    existingTrip?.treasurerMemberId || members[0]?.id || 'mem-1'
  );
  const [newMemberName, setNewMemberName] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [customCategories, setCustomCategories] = useState<string[]>(
    existingTrip?.customCategories || []
  );
  const [error, setError] = useState('');

  const handleAddMember = () => {
    const trimmed = newMemberName.trim();
    if (!trimmed) return;
    const newId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nextColor = AVATAR_COLORS[members.length % AVATAR_COLORS.length];
    setMembers((prev) => [
      ...prev,
      { id: newId, name: trimmed, role: 'MEMBER', avatarColor: nextColor },
    ]);
    setNewMemberName('');
  };

  const handleRemoveMember = (id: string) => {
    if (members.length <= 2) {
      setError('A group trip must have at least 2 members.');
      return;
    }
    const updated = members.filter((m) => m.id !== id);
    setMembers(updated);
    if (treasurerMemberId === id) {
      setTreasurerMemberId(updated[0].id);
    }
  };

  const handleAddCategory = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed || customCategories.includes(trimmed)) return;
    setCustomCategories((prev) => [...prev, trimmed]);
    setNewCategoryName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Please enter a trip name.');
      return;
    }
    if (!destination.trim()) {
      setError('Please enter a trip destination.');
      return;
    }
    if (members.length === 0) {
      setError('Please add group members.');
      return;
    }

    const finalMembers = members.map((m) => ({
      ...m,
      role:
        m.id === treasurerMemberId
          ? ('TREASURER' as const)
          : m.role === 'ADMIN'
            ? ('ADMIN' as const)
            : ('MEMBER' as const),
    }));

    const tripObj: Trip = {
      id: existingTrip?.id || `trip-${Date.now()}`,
      name: name.trim(),
      destination: destination.trim(),
      startDate,
      endDate,
      currency,
      budgetPaise: toPaise(budgetInput),
      description: description.trim(),
      treasurerMemberId,
      status: existingTrip?.status || 'ACTIVE',
      allowNegativePool,
      members: finalMembers,
      customCategories,
      closedAt: existingTrip?.closedAt || null,
      updatedAt: new Date().toISOString(),
      syncStatus: 'PENDING',
    };

    await onSaveTrip(tripObj);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trip-modal-title"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl my-8">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <h2 id="trip-modal-title" className="text-xl font-bold text-slate-900 dark:text-white">
            {existingTrip ? 'Manage Trip & Group Members' : 'Create New Group Trip'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close trip dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="trip-name-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Trip Name
              </label>
              <input
                id="trip-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Goa Trip 2026"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label
                htmlFor="trip-dest-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Destination
              </label>
              <input
                id="trip-dest-input"
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g., North Goa, India"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-white"
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="AED">AED</option>
                <option value="THB">THB (฿)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Trip Budget
              </label>
              <input
                type="number"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Trip Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of itinerary & shared wallet rules"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white"
            />
          </div>

          {/* Group Members & Treasurer Selection */}
          <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Group Members &amp; Appointed Treasurer ({members.length})
              </span>
              <span className="text-[11px] text-slate-500">
                Click radio to appoint Treasurer
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="Add friend's name (e.g., Vikram)"
                className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={handleAddMember}
                className="flex items-center gap-1 rounded-xl bg-slate-900 dark:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Friend</span>
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 max-h-44 overflow-y-auto">
              {members.map((m) => {
                const isTreasurer = m.id === treasurerMemberId;
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between px-3.5 py-2 text-xs"
                  >
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="radio"
                        name="treasurer-radio"
                        checked={isTreasurer}
                        onChange={() => setTreasurerMemberId(m.id)}
                      />
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {m.name}
                      </span>
                      {isTreasurer && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Treasurer
                        </span>
                      )}
                    </label>
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(m.id)}
                      aria-label={`Remove ${m.name}`}
                      className="text-slate-400 hover:text-rose-500 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Custom Expense Categories */}
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
              Custom Expense Categories
            </span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g., Water Sports, Nightlife"
                className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold"
              >
                Add Category
              </button>
            </div>
            {customCategories.length > 0 && (
              <p className="text-xs text-slate-500">
                Custom: {customCategories.join(' · ')}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={allowNegativePool}
              onChange={(e) => setAllowNegativePool(e.target.checked)}
              className="rounded"
            />
            <span>Allow Pool Overdraft (permit negative common pool balance by default)</span>
          </label>

          {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            {existingTrip && onDeleteTrip ? (
              <button
                type="button"
                onClick={async () => {
                  await onDeleteTrip(existingTrip.id);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100 px-3.5 py-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Whole Trip</span>
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-xs font-semibold text-white"
              >
                {existingTrip ? 'Save Trip Changes' : 'Create Trip'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
