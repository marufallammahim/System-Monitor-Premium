/**
 * System Monitor — Premium
 * Disk Storage and Partition Telemetry Provider
 *
 * Reads mounted filesystems from /proc/mounts and queries capacity asynchronously
 * via Gio.File.query_filesystem_info_async.
 *
 * Handles:
 * - Virtual/pseudo filesystems (filtered out)
 * - Duplicate mount points / bind mounts (deduplicated by device + subvolume/root)
 * - Removable storage and network mounts
 * - Permission errors and mounts that disappear while the popup is open
 * - Clear distinction between physical parent block device, partition, and mount point
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    SensorStatus,
    readFileAsync,
    formatBytes,
} from './telemetry.js';

const IGNORED_FS_TYPES = new Set([
    'proc', 'sysfs', 'devtmpfs', 'devpts', 'tmpfs', 'securityfs',
    'cgroup', 'cgroup2', 'pstore', 'efivarfs', 'bpf', 'autofs',
    'mqueue', 'hugetlbfs', 'debugfs', 'tracefs', 'configfs',
    'fusectl', 'fuse.gvfsd-fuse', 'fuse.portal', 'squashfs',
    'overlay', 'nsfs', 'ramfs', 'rpc_pipefs', 'binfmt_misc',
]);

const NETWORK_FS_TYPES = new Set([
    'nfs', 'nfs4', 'cifs', 'smb3', 'smbfs', 'fuse.sshfs', '9p', 'ceph', 'glusterfs',
]);

export class StorageProvider {
    constructor() {
        this._lastValidMounts = [];
    }

    async collect(cancellable = null) {
        const mountsRes = await readFileAsync('/proc/mounts', cancellable);
        if (!mountsRes.ok || !mountsRes.text) {
            return {
                status: mountsRes.status,
                primaryMount: null,
                partitions: [],
            };
        }

        const candidateMounts = [];
        const seenMountPoints = new Set();
        const seenDevices = new Map(); // device -> shortest mountPoint

        for (const rawLine of mountsRes.text.split('\n')) {
            const line = rawLine.trim();
            if (!line)
                continue;
            const parts = line.split(/\s+/);
            if (parts.length < 3)
                continue;

            const device = this._unescapeMountPath(parts[0]);
            const mountPoint = this._unescapeMountPath(parts[1]);
            const fsType = parts[2];

            if (IGNORED_FS_TYPES.has(fsType))
                continue;

            if (
                mountPoint.startsWith('/proc') ||
                mountPoint.startsWith('/sys') ||
                mountPoint.startsWith('/dev') ||
                mountPoint.startsWith('/run/user') ||
                mountPoint.startsWith('/run/credentials') ||
                mountPoint.startsWith('/var/lib/docker') ||
                mountPoint.startsWith('/snap/')
            ) {
                continue;
            }

            const isBlockDevice = device.startsWith('/dev/');
            const isNetworkMount = NETWORK_FS_TYPES.has(fsType);
            if (!isBlockDevice && !isNetworkMount && mountPoint !== '/')
                continue;

            if (seenMountPoints.has(mountPoint))
                continue;
            seenMountPoints.add(mountPoint);

            // Deduplicate bind mounts of the same block device (keep '/' or shortest mount path, plus '/home' and '/boot')
            if (isBlockDevice && seenDevices.has(device)) {
                const importantPaths = new Set(['/', '/home', '/boot', '/boot/efi']);
                if (!importantPaths.has(mountPoint))
                    continue;
            }
            seenDevices.set(device, mountPoint);

            candidateMounts.push({
                device,
                mountPoint,
                fsType,
                isNetworkMount,
                isRemovable: mountPoint.startsWith('/run/media/') || mountPoint.startsWith('/media/'),
                physicalDisk: this._inferParentDiskDevice(device),
            });
        }

        // Prioritize /, /home, /boot, and then alphabetical
        candidateMounts.sort((a, b) => {
            if (a.mountPoint === '/')
                return -1;
            if (b.mountPoint === '/')
                return 1;
            if (a.mountPoint === '/home')
                return -1;
            if (b.mountPoint === '/home')
                return 1;
            return a.mountPoint.localeCompare(b.mountPoint);
        });

        const partitions = await Promise.all(
            candidateMounts.slice(0, 12).map(m => this._queryMountCapacity(m, cancellable))
        );

        const validPartitions = partitions.filter(p => p !== null);
        const primaryMount = validPartitions.find(p => p.mountPoint === '/') || validPartitions[0] || null;

        this._lastValidMounts = validPartitions;

        return {
            status: validPartitions.length > 0 ? SensorStatus.AVAILABLE : SensorStatus.NOT_AVAILABLE,
            primaryMount,
            partitions: validPartitions,
        };
    }

    async _queryMountCapacity(mountEntry, cancellable) {
        try {
            const file = Gio.File.new_for_path(mountEntry.mountPoint);
            const info = await file.query_filesystem_info_async(
                'filesystem::size,filesystem::free,filesystem::used,filesystem::type,filesystem::readonly',
                GLib.PRIORITY_DEFAULT,
                cancellable
            );

            const totalBytes = info.get_attribute_uint64('filesystem::size');
            const freeBytes = info.get_attribute_uint64('filesystem::free');
            let usedBytes = info.has_attribute('filesystem::used')
                ? info.get_attribute_uint64('filesystem::used')
                : Math.max(0, totalBytes - freeBytes);

            if (totalBytes === 0)
                return null;

            usedBytes = Math.min(totalBytes, Math.max(0, usedBytes));
            const usedPercent = Math.min(100, Math.max(0, (usedBytes / totalBytes) * 100));

            return {
                ...mountEntry,
                status: SensorStatus.AVAILABLE,
                totalBytes,
                usedBytes,
                freeBytes,
                usedPercent,
                totalFormatted: formatBytes(totalBytes, 1),
                usedFormatted: formatBytes(usedBytes, 1),
                freeFormatted: formatBytes(freeBytes, 1),
                readOnly: info.get_attribute_boolean('filesystem::readonly'),
            };
        } catch (err) {
            if (err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PERMISSION_DENIED)) {
                return {
                    ...mountEntry,
                    status: SensorStatus.PERMISSION_DENIED,
                    totalBytes: null,
                    usedBytes: null,
                    freeBytes: null,
                    usedPercent: null,
                    totalFormatted: 'Permission Denied',
                    usedFormatted: 'N/A',
                    freeFormatted: 'N/A',
                    readOnly: false,
                };
            }
            // Mount disappeared or became unreachable
            return null;
        }
    }

    _unescapeMountPath(raw) {
        return raw
            .replace(/\\040/g, ' ')
            .replace(/\\011/g, '\t')
            .replace(/\\012/g, '\n')
            .replace(/\\134/g, '\\');
    }

    _inferParentDiskDevice(devicePath) {
        if (!devicePath.startsWith('/dev/'))
            return 'Virtual / Network';
        const base = devicePath.slice(5);
        // NVMe / MMC: nvme0n1p2 -> nvme0n1, mmcblk0p1 -> mmcblk0
        const nvmeMatch = base.match(/^(nvme\d+n\d+|mmcblk\d+)p\d+$/);
        if (nvmeMatch)
            return `/dev/${nvmeMatch[1]}`;
        // SATA / SCSI / VirtIO: sda2 -> sda, vda1 -> vda
        const sdMatch = base.match(/^([a-z]+)\d+$/);
        if (sdMatch)
            return `/dev/${sdMatch[1]}`;
        return devicePath;
    }

    destroy() {
        this._lastValidMounts = [];
    }
}
