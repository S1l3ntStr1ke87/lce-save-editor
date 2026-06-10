import { useState, useMemo } from 'react';
import {
  Table, Button, Space, Tooltip, Modal, InputNumber,
  Typography, Slider, Select, message, Input, Segmented,
} from 'antd';
import { ThunderboltOutlined, PlusOutlined, SearchOutlined, DeleteOutlined, AppstoreOutlined, UnorderedListOutlined } from '@ant-design/icons';
import type { LoadedSave } from '../lib/containers';
import type { NbtCompound, NbtList, NbtByte, NbtShort } from '../lib/nbt';
import { TagType, nbt, cloneNbt } from '../lib/nbt';
import { getItemName, getMaxDamage, getItemCategory, CATEGORY_COLORS, ITEM_NAMES } from '../lib/items';
import { ENCHANTMENTS, ENCHANT_BY_ID, enchantLabel, toRoman } from '../lib/enchants';
import ItemIcon from './ItemIcon';
import InventoryCanvas from './InventoryCanvas';

const { Text } = Typography;

// ── types ─────────────────────────────────────────────────────────────────────

interface EnchantEntry { id: number; lvl: number }

interface InventoryItem {
  slot: number;
  id: number;
  count: number;
  damage: number;
  enchants: EnchantEntry[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function getSlotLabel(slot: number): string {
  if (slot >= 100) return `Armor ${slot - 100}`;
  if (slot < 9)    return `Bar ${slot}`;
  return `Inv ${slot}`;
}

function parseEnchants(tags: Record<string, import('../lib/nbt').NbtValue>): EnchantEntry[] {
  const tagComp = tags['tag'];
  if (!tagComp || tagComp.type !== TagType.Compound) return [];
  const enchList = (tagComp as NbtCompound).tags['ench'];
  if (!enchList || enchList.type !== TagType.List) return [];
  return (enchList as NbtList).items
    .filter(it => it.type === TagType.Compound)
    .map(it => {
      const t = (it as NbtCompound).tags;
      return {
        id:  t['id']?.type  === TagType.Short ? (t['id']  as NbtShort).value : 0,
        lvl: t['lvl']?.type === TagType.Short ? (t['lvl'] as NbtShort).value : 1,
      };
    });
}

function parseInventory(tags: Record<string, import('../lib/nbt').NbtValue>): InventoryItem[] {
  const list = tags['Inventory'];
  if (!list || list.type !== TagType.List) return [];
  return (list as NbtList).items
    .filter(it => it.type === TagType.Compound)
    .map(it => {
      const t = (it as NbtCompound).tags;
      return {
        slot:    t['Slot']?.type   === TagType.Byte  ? (t['Slot']  as NbtByte).value   : 0,
        id:      t['id']?.type     === TagType.Short ? (t['id']    as NbtShort).value  : 0,
        count:   t['Count']?.type  === TagType.Byte  ? (t['Count'] as NbtByte).value   : 1,
        damage:  t['Damage']?.type === TagType.Short ? (t['Damage'] as NbtShort).value : 0,
        enchants: parseEnchants(t),
      };
    })
    .sort((a, b) => a.slot - b.slot);
}

function durabilityColor(ratio: number): string {
  if (ratio > 0.6) return '#4ade80';
  if (ratio > 0.25) return '#facc15';
  return '#f87171';
}

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  loaded: LoadedSave;
  onUpdate: (updater: (s: LoadedSave) => LoadedSave) => void;
}

export default function InventoryTab({ loaded, onUpdate }: Props) {
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [giveOpen, setGiveOpen]       = useState(false);
  const [search, setSearch]           = useState('');
  const [view, setView]               = useState<'canvas' | 'table'>('canvas');
  const [msgApi, ctx]                 = message.useMessage();

  const items = useMemo(
    () => parseInventory(loaded.playerNbt.root.tags),
    [loaded.playerNbt]
  );

  const editingItem = editingSlot !== null ? items.find(i => i.slot === editingSlot) : null;
  const maxDmg      = editingItem ? getMaxDamage(editingItem.id) : 0;

  // ── mutators ────────────────────────────────────────────────────────────────

  function mutate(fn: (tags: Record<string, import('../lib/nbt').NbtValue>) => void) {
    onUpdate(s => {
      const clone = cloneNbt(s.playerNbt);
      fn(clone.root.tags);
      return { ...s, playerNbt: clone };
    });
  }

  function updateItem(slot: number, changes: Partial<InventoryItem & { enchants: EnchantEntry[] }>) {
    mutate(tags => {
      const list = tags['Inventory'] as NbtList;
      list.items = list.items.map(it => {
        if (it.type !== TagType.Compound) return it;
        const t = (it as NbtCompound).tags;
        const s = t['Slot']?.type === TagType.Byte ? (t['Slot'] as NbtByte).value : -1;
        if (s !== slot) return it;
        if (changes.damage  !== undefined) t['Damage'] = nbt.short(changes.damage);
        if (changes.count   !== undefined) t['Count']  = nbt.byte(changes.count);
        if (changes.id      !== undefined) t['id']     = nbt.short(changes.id);
        if (changes.enchants !== undefined) writeEnchants(t, changes.enchants);
        return it;
      });
    });
  }

  function writeEnchants(tags: Record<string, import('../lib/nbt').NbtValue>, enchants: EnchantEntry[]) {
    if (enchants.length === 0) {
      // remove the ench list but leave any other tag data intact
      const tagComp = tags['tag'];
      if (tagComp?.type === TagType.Compound) {
        delete (tagComp as NbtCompound).tags['ench'];
        if (Object.keys((tagComp as NbtCompound).tags).length === 0) delete tags['tag'];
      }
      return;
    }
    let tagComp = tags['tag'];
    if (!tagComp || tagComp.type !== TagType.Compound) {
      tagComp = nbt.compound({});
      tags['tag'] = tagComp;
    }
    (tagComp as NbtCompound).tags['ench'] = {
      type: TagType.List,
      elementType: TagType.Compound,
      items: enchants.map(e => nbt.compound({ id: nbt.short(e.id), lvl: nbt.short(e.lvl) })),
    };
  }

  function swapItems(srcSlot: number, dstSlot: number) {
    if (srcSlot === dstSlot) return
    mutate(tags => {
      const list = tags['Inventory'] as NbtList
      const items = list.items
      const srcIdx = items.findIndex(it =>
        it.type === TagType.Compound &&
        ((it as NbtCompound).tags['Slot'] as NbtByte | undefined)?.value === srcSlot
      )
      const dstIdx = items.findIndex(it =>
        it.type === TagType.Compound &&
        ((it as NbtCompound).tags['Slot'] as NbtByte | undefined)?.value === dstSlot
      )
      if (srcIdx === -1) return
      if (dstIdx === -1) {
        // destination is empty — just move the source item there
        ((items[srcIdx] as NbtCompound).tags['Slot'] as NbtByte).value = dstSlot
      } else {
        // both slots occupied — swap their slot numbers
        ((items[srcIdx] as NbtCompound).tags['Slot'] as NbtByte).value = dstSlot;
        ((items[dstIdx] as NbtCompound).tags['Slot'] as NbtByte).value = srcSlot
      }
    })
  }

  function deleteItem(slot: number) {
    mutate(tags => {
      const list = tags['Inventory'] as NbtList;
      list.items = list.items.filter(it => {
        if (it.type !== TagType.Compound) return true;
        const s = ((it as NbtCompound).tags['Slot'] as NbtByte | undefined)?.value;
        return s !== slot;
      });
    });
    setEditingSlot(null);
  }

  function repairAll() {
    mutate(tags => {
      const list = tags['Inventory'] as NbtList;
      list.items.forEach(it => {
        if (it.type !== TagType.Compound) return;
        const t = (it as NbtCompound).tags;
        const id = t['id']?.type === TagType.Short ? (t['id'] as NbtShort).value : 0;
        if (getMaxDamage(id) > 0) t['Damage'] = nbt.short(0);
      });
    });
    msgApi.success('All items repaired');
  }

  function maxAllStacks() {
    mutate(tags => {
      const list = tags['Inventory'] as NbtList;
      list.items.forEach(it => {
        if (it.type !== TagType.Compound) return;
        (it as NbtCompound).tags['Count'] = nbt.byte(64);
      });
    });
    msgApi.success('All stacks maxed to 64');
  }

  function giveItem(id: number, count: number, damage: number) {
    const usedSlots = new Set(items.map(i => i.slot));
    let freeSlot = -1;
    for (let i = 0; i <= 35; i++) { if (!usedSlots.has(i)) { freeSlot = i; break; } }
    if (freeSlot === -1) { msgApi.error('Inventory is full'); return; }
    mutate(tags => {
      (tags['Inventory'] as NbtList).items.push(nbt.compound({
        Slot: nbt.byte(freeSlot), id: nbt.short(id), Count: nbt.byte(count), Damage: nbt.short(damage),
      }));
    });
    msgApi.success(`Added ${getItemName(id)} to slot ${freeSlot}`);
    setGiveOpen(false);
  }

  // ── table ────────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter(i => !q || getItemName(i.id).toLowerCase().includes(q) || String(i.id).includes(q));
  }, [items, search]);

  const columns = [
    {
      title: 'Slot', dataIndex: 'slot', width: 64,
      render: (slot: number) => <span className="slot-badge">{getSlotLabel(slot)}</span>,
    },
    {
      title: 'Item', dataIndex: 'id', width: 280,
      render: (id: number, row: InventoryItem) => {
        const cat   = getItemCategory(id);
        const color = CATEGORY_COLORS[cat];
        return (
          <Space size={8} align="center">
            <ItemIcon itemId={id} size={24} />
            <div>
              <div style={{ color: '#e6edf3', fontSize: 13, fontFamily: "'Mojangles', monospace", lineHeight: 1.3 }}>
                {getItemName(id)}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                <span style={{ fontSize: 10, color: '#484f58', fontFamily: 'monospace' }}>#{id}</span>
                {row.enchants.map(e => (
                  <span key={e.id} className="ench-badge">
                    {enchantLabel(e.id, e.lvl)}
                  </span>
                ))}
              </div>
            </div>
          </Space>
        );
      },
    },
    {
      title: 'Count', dataIndex: 'count', width: 70,
      render: (count: number, row: InventoryItem) => (
        <InputNumber value={count} min={1} max={64} size="small" style={{ width: 60 }}
          onChange={v => v !== null && updateItem(row.slot, { count: v })} />
      ),
    },
    {
      title: 'Durability', dataIndex: 'damage', width: 190,
      render: (damage: number, row: InventoryItem) => {
        const max = getMaxDamage(row.id);
        if (max === 0) return <Text style={{ color: '#484f58' }}>—</Text>;
        const remaining = max - damage;
        const ratio = remaining / max;
        return (
          <div style={{ width: 180 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6e7681', marginBottom: 2 }}>
              <span>{remaining} / {max}</span>
              <span>{Math.round(ratio * 100)}%</span>
            </div>
            <div className="durability-bar">
              <div className="durability-fill" style={{ width: `${ratio * 100}%`, background: durabilityColor(ratio) }} />
            </div>
          </div>
        );
      },
    },
    {
      title: '', key: 'actions', width: 90,
      render: (_: unknown, row: InventoryItem) => (
        <Space size={4}>
          <Button size="small" type="text" onClick={() => setEditingSlot(row.slot)}>Edit</Button>
          <Button size="small" type="text" danger icon={<DeleteOutlined />}
            onClick={() => deleteItem(row.slot)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      {ctx}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <Space wrap>
          <Tooltip title="Set Damage=0 on all damageable items">
            <Button icon={<ThunderboltOutlined />} onClick={repairAll} size="small">Repair All</Button>
          </Tooltip>
          <Button onClick={maxAllStacks} size="small">Max Stacks</Button>
          <Button icon={<PlusOutlined />} type="dashed" size="small" onClick={() => setGiveOpen(true)}>Give Item</Button>
        </Space>
        <Space>
          {view === 'table' && (
            <Input prefix={<SearchOutlined style={{ color: '#484f58' }} />} placeholder="Search items…"
              size="small" style={{ width: 180 }} value={search} onChange={e => setSearch(e.target.value)} />
          )}
          <Segmented
            size="small"
            value={view}
            onChange={v => setView(v as 'canvas' | 'table')}
            options={[
              { value: 'canvas', icon: <AppstoreOutlined />, label: 'GUI' },
              { value: 'table',  icon: <UnorderedListOutlined />, label: 'List' },
            ]}
          />
        </Space>
      </div>

      {view === 'canvas' ? (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flexShrink: 0 }}>
            <InventoryCanvas loaded={loaded} onEditSlot={setEditingSlot} onSwapSlots={swapItems} />
            <div style={{ marginTop: 8, fontSize: 11, color: '#484f58', fontFamily: 'Mojangles, monospace' }}>
              Click a slot to edit · {items.length} items · {36 - items.filter(i => i.slot < 36).length} free slots
            </div>
          </div>
          {/* item detail panel — shown when a slot is selected in canvas view */}
          {editingSlot !== null && editingItem && (
            <div className="mc-panel" style={{ flex: 1, minWidth: 260, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <ItemIcon itemId={editingItem.id} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'Mojangles, monospace', fontSize: 14, color: '#e6edf3' }}>{getItemName(editingItem.id)}</div>
                  <div style={{ fontSize: 11, color: '#484f58' }}>slot {editingSlot} · #{editingItem.id}</div>
                </div>
                <Button
                  size="small" danger type="text" icon={<DeleteOutlined />}
                  onClick={() => deleteItem(editingSlot)}
                  title="Delete item from slot"
                />
              </div>
              <ItemEditPanel item={editingItem} slot={editingSlot} maxDmg={maxDmg} updateItem={updateItem} />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mc-panel" style={{ overflow: 'hidden' }}>
            <Table dataSource={filtered} columns={columns} rowKey="slot" size="small"
              pagination={false} scroll={{ y: 'calc(100vh - 320px)' }} style={{ background: 'transparent' }} />
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: 12, color: '#484f58', fontFamily: 'Mojangles, monospace' }}>
            <span>{items.length} items</span>
            <span>{items.filter(i => getMaxDamage(i.id) > 0 && i.damage > 0).length} damaged</span>
            <span>{36 - items.filter(i => i.slot < 36).length} free slots</span>
            <span>{items.reduce((n, i) => n + i.enchants.length, 0)} enchantments</span>
          </div>
        </>
      )}

      {/* ── item edit modal (table view only) ───────────────────────────── */}
      {view === 'table' && (
        <Modal open={editingSlot !== null} onCancel={() => setEditingSlot(null)}
          title={
            editingItem
              ? <span style={{ fontFamily: 'Mojangles, sans-serif' }}>{getItemName(editingItem.id)}<span style={{ color: '#484f58', fontWeight: 400, fontSize: 12 }}> — slot {editingSlot}</span></span>
              : 'Edit Item'
          }
          width={480}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button danger icon={<DeleteOutlined />}
                onClick={() => editingSlot !== null && deleteItem(editingSlot)}>
                Delete Item
              </Button>
              <Button onClick={() => setEditingSlot(null)}>Close</Button>
            </div>
          }
        >
          {editingItem && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ color: '#6e7681', marginBottom: 4, fontSize: 12 }}>Move to Slot</div>
                <Select
                  value={editingSlot!}
                  style={{ width: '100%' }}
                  onChange={(newSlot: number) => {
                    swapItems(editingSlot!, newSlot)
                    setEditingSlot(newSlot)
                  }}
                  options={[
                    ...Array.from({ length: 9 },  (_, i) => ({ value: i,       label: `Hotbar ${i}${items.some(x => x.slot === i       && i       !== editingSlot) ? ' (swap)' : ''}` })),
                    ...Array.from({ length: 27 }, (_, i) => ({ value: i + 9,   label: `Inv ${i + 9}${items.some(x => x.slot === i+9     && i+9     !== editingSlot) ? ' (swap)' : ''}` })),
                    { value: 100, label: `Armor Helmet${items.some(x => x.slot === 100 && 100 !== editingSlot) ? ' (swap)' : ''}` },
                    { value: 101, label: `Armor Chestplate${items.some(x => x.slot === 101 && 101 !== editingSlot) ? ' (swap)' : ''}` },
                    { value: 102, label: `Armor Leggings${items.some(x => x.slot === 102 && 102 !== editingSlot) ? ' (swap)' : ''}` },
                    { value: 103, label: `Armor Boots${items.some(x => x.slot === 103 && 103 !== editingSlot) ? ' (swap)' : ''}` },
                  ]}
                />
              </div>
              <ItemEditPanel item={editingItem} slot={editingSlot!} maxDmg={maxDmg} updateItem={updateItem} />
            </div>
          )}
        </Modal>
      )}

      {/* ── give item modal ─────────────────────────────────────────────── */}
      <GiveItemModal open={giveOpen} onClose={() => setGiveOpen(false)} onGive={giveItem} />
    </div>
  );
}

// ── item edit panel (shared between the canvas side-panel and the table modal) ─

function ItemEditPanel({
  item, slot, maxDmg, updateItem,
}: {
  item: InventoryItem;
  slot: number;
  maxDmg: number;
  updateItem: (slot: number, changes: Partial<InventoryItem & { enchants: EnchantEntry[] }>) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* count */}
      <div>
        <div style={{ color: '#6e7681', marginBottom: 4, fontSize: 12 }}>Count (1–64)</div>
        <InputNumber value={item.count} min={1} max={64} style={{ width: '100%' }}
          onChange={v => v !== null && updateItem(slot, { count: v })} />
      </div>

      {/* damage / durability */}
      {maxDmg > 0 && (
        <div>
          <div style={{ color: '#6e7681', marginBottom: 4, fontSize: 12 }}>
            Damage (0 = pristine / {maxDmg} = broken)
          </div>
          <Slider min={0} max={maxDmg} value={item.damage}
            onChange={v => updateItem(slot, { damage: v })}
            trackStyle={{ background: durabilityColor(1 - item.damage / maxDmg) }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <InputNumber value={item.damage} min={0} max={maxDmg} size="small" style={{ width: 90 }}
              onChange={v => v !== null && updateItem(slot, { damage: v })} />
            <Button size="small" type="link" style={{ color: '#4ade80' }}
              onClick={() => updateItem(slot, { damage: 0 })}>
              Repair
            </Button>
          </div>
        </div>
      )}

      {/* item id */}
      <div>
        <div style={{ color: '#6e7681', marginBottom: 4, fontSize: 12 }}>Item ID</div>
        <InputNumber value={item.id} min={1} max={32767} style={{ width: '100%' }}
          addonAfter={<span style={{ fontSize: 11, fontFamily: 'Mojangles, monospace' }}>{getItemName(item.id)}</span>}
          onChange={v => v !== null && updateItem(slot, { id: v })} />
      </div>

      {/* enchantments */}
      <EnchantEditor
        enchants={item.enchants}
        onChange={enchants => updateItem(slot, { enchants })}
      />
    </div>
  );
}

// ── enchantment editor sub-component ─────────────────────────────────────────

function EnchantEditor({
  enchants, onChange,
}: {
  enchants: EnchantEntry[];
  onChange: (e: EnchantEntry[]) => void;
}) {
  function addEnchant() {
    const used = new Set(enchants.map(e => e.id));
    const first = ENCHANTMENTS.find(e => !used.has(e.id));
    if (!first) return;
    onChange([...enchants, { id: first.id, lvl: 1 }]);
  }

  function removeEnchant(idx: number) {
    onChange(enchants.filter((_, i) => i !== idx));
  }

  function updateEnchant(idx: number, field: 'id' | 'lvl', value: number) {
    onChange(enchants.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  }

  const usedIds = new Set(enchants.map(e => e.id));
  const availableForAdd = ENCHANTMENTS.filter(e => !usedIds.has(e.id));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: '#c084fc', fontFamily: 'Mojangles, monospace', fontSize: 13 }}>
          Enchantments
        </span>
        <Button
          size="small" type="dashed" icon={<PlusOutlined />}
          onClick={addEnchant}
          disabled={availableForAdd.length === 0}
          style={{ borderColor: '#7c3aed', color: '#c084fc', fontSize: 11 }}
        >
          Add
        </Button>
      </div>

      {enchants.length === 0 && (
        <div style={{ color: '#484f58', fontSize: 12, textAlign: 'center', padding: '8px 0' }}>
          No enchantments
        </div>
      )}

      {enchants.map((ench, idx) => {
        const def = ENCHANT_BY_ID[ench.id];
        const maxLvl = def?.maxLevel ?? 10;
        const otherIds = new Set(enchants.filter((_, i) => i !== idx).map(e => e.id));
        const idOptions = ENCHANTMENTS
          .filter(e => !otherIds.has(e.id))
          .map(e => ({ value: e.id, label: e.name }));

        return (
          <div
            key={idx}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
              background: '#0d1117', border: '1px solid #7c3aed44',
              borderRadius: 6, padding: '6px 10px',
            }}
          >
            <Select
              value={ench.id}
              options={idOptions}
              size="small"
              style={{ flex: 1 }}
              onChange={v => updateEnchant(idx, 'id', v)}
            />
            <Select
              value={ench.lvl}
              size="small"
              style={{ width: 70 }}
              onChange={v => updateEnchant(idx, 'lvl', v)}
              options={Array.from({ length: maxLvl }, (_, i) => ({
                value: i + 1,
                label: toRoman(i + 1),
              }))}
            />
            <span className="ench-badge" style={{ fontSize: 9, minWidth: 28, textAlign: 'center' }}>
              {toRoman(ench.lvl)}
            </span>
            <Button
              type="text" size="small" danger
              icon={<DeleteOutlined />}
              onClick={() => removeEnchant(idx)}
              style={{ padding: '0 4px', flexShrink: 0 }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── give item modal ───────────────────────────────────────────────────────────

function GiveItemModal({
  open, onClose, onGive,
}: {
  open: boolean;
  onClose: () => void;
  onGive: (id: number, count: number, damage: number) => void;
}) {
  const [search, setSearch]       = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [count, setCount]         = useState(1);
  const [damage, setDamage]       = useState(0);

  const options = useMemo(() => {
    const q = search.toLowerCase();
    return Object.entries(ITEM_NAMES)
      .filter(([id, name]) => !q || name.toLowerCase().includes(q) || id.includes(q))
      .slice(0, 500) // update limit to 500 blocks
      .map(([id, name]) => ({ value: Number(id), label: `${name} (#${id})` }));
  }, [search]);

  return (
    <Modal open={open} onCancel={onClose}
      onOk={() => { if (selectedId !== null) onGive(selectedId, count, damage); }}
      okText="Give" okButtonProps={{ disabled: selectedId === null }} title="Give Item" width={420}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
        <div>
          <div style={{ color: '#6e7681', marginBottom: 6, fontSize: 12 }}>Search item</div>
          <Select showSearch value={selectedId} onSearch={setSearch}
            onChange={v => { setSelectedId(v); setDamage(0); }}
            options={options} filterOption={false} style={{ width: '100%' }}
            placeholder="Type to search…" />
        </div>
        <div>
          <div style={{ color: '#6e7681', marginBottom: 6, fontSize: 12 }}>Count</div>
          <InputNumber value={count} min={1} max={64} style={{ width: '100%' }}
            onChange={v => v && setCount(v)} />
        </div>
        {selectedId !== null && getMaxDamage(selectedId) > 0 && (
          <div>
            <div style={{ color: '#6e7681', marginBottom: 6, fontSize: 12 }}>Damage (0 = pristine)</div>
            <InputNumber value={damage} min={0} max={getMaxDamage(selectedId)}
              style={{ width: '100%' }} onChange={v => v !== null && setDamage(v)} />
          </div>
        )}
      </div>
    </Modal>
  );
}
