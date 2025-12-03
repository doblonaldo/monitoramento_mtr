-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Host" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "destination" TEXT NOT NULL,
    "title" TEXT,
    "categoryId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "Host_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MonitoringLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hostId" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "output" TEXT NOT NULL,
    "isChange" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "MonitoringLog_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Host_destination_key" ON "Host"("destination");
