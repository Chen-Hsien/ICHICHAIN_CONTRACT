// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

abstract contract SeriesSaleSchedule {
    struct SaleSchedule {
        uint64 revision;
        uint64 expectedDelistAt;
        bool inactive;
    }
    /// @custom:storage-location erc7201:doudochain.storage.SeriesSaleSchedule
    struct ScheduleStorage {
        mapping(uint256 => SaleSchedule) schedules;
    }

    function _scheduleStorage() private pure returns (ScheduleStorage storage data) {
        assembly { data.slot := 0x5dfaa24eb8c63d79e81ee28efd11de2f5738631f312679a895cd7e78b1062b00 }
    }

    function saleSchedules(uint256 seriesId) public view returns (SaleSchedule memory) {
        return _scheduleStorage().schedules[seriesId];
    }
    event SeriesSaleScheduleChanged(uint256 indexed seriesId, uint64 revision, uint64 expectedDelistAt, bool inactive);
    error StaleSaleSchedule();
    error SeriesSaleEnded();

    function _setSaleSchedule(uint256 seriesId, uint64 expectedRevision, uint64 expectedDelistAt, bool inactive) internal {
        SaleSchedule storage schedule = _scheduleStorage().schedules[seriesId];
        if (schedule.revision != expectedRevision) revert StaleSaleSchedule();
        uint64 revision = expectedRevision + 1;
        _scheduleStorage().schedules[seriesId] = SaleSchedule(revision, expectedDelistAt, inactive);
        emit SeriesSaleScheduleChanged(seriesId, revision, expectedDelistAt, inactive);
    }

    function _requireOpenSale(uint256 seriesId) internal view {
        SaleSchedule storage schedule = _scheduleStorage().schedules[seriesId];
        if (schedule.inactive || (schedule.expectedDelistAt != 0 && block.timestamp >= schedule.expectedDelistAt)) {
            revert SeriesSaleEnded();
        }
    }
}
