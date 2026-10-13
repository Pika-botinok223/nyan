from __future__ import annotations

from typing import Any, Iterable

import aiosqlite


class Database:
    """Thin async wrapper around a single shared SQLite connection.

    Each cog creates its own tables in ``cog_load`` via :meth:`executescript`
    (use ``CREATE TABLE IF NOT EXISTS``). Writes are committed immediately.
    """

    def __init__(self, path: str) -> None:
        self.path = path
        self._conn: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        self._conn = await aiosqlite.connect(self.path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA foreign_keys=ON")
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database is not connected")
        return self._conn

    async def executescript(self, script: str) -> None:
        await self.conn.executescript(script)
        await self.conn.commit()

    async def execute(self, sql: str, params: Iterable[Any] = ()) -> int:
        """Run a write statement and commit. Returns the number of affected rows."""
        cursor = await self.conn.execute(sql, tuple(params))
        await self.conn.commit()
        return cursor.rowcount

    async def fetchone(self, sql: str, params: Iterable[Any] = ()) -> aiosqlite.Row | None:
        async with self.conn.execute(sql, tuple(params)) as cursor:
            return await cursor.fetchone()

    async def fetchall(self, sql: str, params: Iterable[Any] = ()) -> list[aiosqlite.Row]:
        async with self.conn.execute(sql, tuple(params)) as cursor:
            return list(await cursor.fetchall())
