// server/whatsapp/whatsapp-handler.js
const WhatsAppClient = require('./whatsapp-client');

class WhatsAppHandler {
    constructor() {
        this.client = new WhatsAppClient();
        this.activeSessions = new Map();
        this.boostOperations = new Map();
    }

    async initializeSession(sessionId) {
        try {
            if (!this.activeSessions.has(sessionId)) {
                await this.client.initialize();
                this.activeSessions.set(sessionId, {
                    client: this.client,
                    status: 'connected',
                    lastActivity: Date.now()
                });
            }
            return { success: true, sessionId };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async handleChannelBoost(sessionId, channelLink, phoneNumbers, operationId) {
        try {
            // Check if session exists
            if (!this.activeSessions.has(sessionId)) {
                return { 
                    success: false, 
                    error: 'Session not initialized. Please initialize WhatsApp first.' 
                };
            }

            // Start boost operation
            this.boostOperations.set(operationId, {
                type: 'channel',
                status: 'processing',
                progress: 0,
                total: phoneNumbers.length,
                completed: 0,
                startTime: Date.now()
            });

            // Process in batches to avoid rate limiting
            const batchSize = 5;
            const results = {
                success: [],
                failed: [],
                total: phoneNumbers.length
            };

            for (let i = 0; i < phoneNumbers.length; i += batchSize) {
                const batch = phoneNumbers.slice(i, i + batchSize);
                
                try {
                    const batchResults = await this.client.followNewsletter(channelLink, batch);
                    
                    // Combine results
                    results.success.push(...batchResults.success);
                    results.failed.push(...batchResults.failed);
                    
                    // Update progress
                    const completed = i + batch.length;
                    const progress = Math.round((completed / phoneNumbers.length) * 100);
                    
                    this.boostOperations.set(operationId, {
                        ...this.boostOperations.get(operationId),
                        progress: progress,
                        completed: completed,
                        status: progress === 100 ? 'completed' : 'processing'
                    });

                    // Broadcast progress update
                    this.broadcastProgress(operationId, progress, completed, phoneNumbers.length);

                    // Delay between batches
                    if (i + batchSize < phoneNumbers.length) {
                        await this.delay(5000);
                    }
                } catch (batchError) {
                    results.failed.push({
                        batch: batch,
                        error: batchError.message
                    });
                }
            }

            // Get updated channel info
            let channelInfo = null;
            try {
                channelInfo = await this.client.getChannelInfo(channelLink);
            } catch (infoError) {
                console.error('Failed to get updated channel info:', infoError);
            }

            // Finalize operation
            this.boostOperations.set(operationId, {
                ...this.boostOperations.get(operationId),
                status: 'completed',
                progress: 100,
                completed: phoneNumbers.length,
                endTime: Date.now(),
                results: results,
                channelInfo: channelInfo
            });

            return {
                success: true,
                operationId,
                results,
                channelInfo,
                duration: Date.now() - this.boostOperations.get(operationId).startTime
            };

        } catch (error) {
            this.boostOperations.set(operationId, {
                ...this.boostOperations.get(operationId),
                status: 'failed',
                error: error.message
            });
            return { success: false, error: error.message };
        }
    }

    async handleGroupBoost(sessionId, groupLink, phoneNumbers, operationId) {
        try {
            // Check if session exists
            if (!this.activeSessions.has(sessionId)) {
                return { 
                    success: false, 
                    error: 'Session not initialized. Please initialize WhatsApp first.' 
                };
            }

            // Check group capacity first
            let groupInfo;
            try {
                groupInfo = await this.client.getGroupInfo(groupLink);
                if (groupInfo.isFull) {
                    return { 
                        success: false, 
                        error: 'Group is full. Cannot add more members.',
                        isFull: true
                    };
                }
            } catch (infoError) {
                return { 
                    success: false, 
                    error: `Failed to get group info: ${infoError.message}` 
                };
            }

            // Calculate available slots
            const availableSlots = 1024 - groupInfo.participants; // WhatsApp group limit
            const numbersToProcess = Math.min(phoneNumbers.length, availableSlots);

            // Start boost operation
            this.boostOperations.set(operationId, {
                type: 'group',
                status: 'processing',
                progress: 0,
                total: numbersToProcess,
                completed: 0,
                startTime: Date.now(),
                groupInfo: groupInfo
            });

            // Process numbers
            const results = {
                success: [],
                failed: [],
                total: numbersToProcess,
                stoppedDueToFull: false
            };

            for (let i = 0; i < numbersToProcess; i++) {
                try {
                    // Check group capacity before each addition
                    const currentGroupInfo = await this.client.getGroupInfo(groupLink);
                    if (currentGroupInfo.isFull) {
                        results.stoppedDueToFull = true;
                        break;
                    }

                    // Add single member
                    const singleResult = await this.client.acceptGroupInvite(groupLink, [phoneNumbers[i]]);
                    
                    if (singleResult.success.length > 0) {
                        results.success.push(phoneNumbers[i]);
                    } else {
                        results.failed.push({
                            number: phoneNumbers[i],
                            error: singleResult.failed[0]?.error || 'Unknown error'
                        });
                    }

                    // Update progress
                    const progress = Math.round(((i + 1) / numbersToProcess) * 100);
                    this.boostOperations.set(operationId, {
                        ...this.boostOperations.get(operationId),
                        progress: progress,
                        completed: i + 1,
                        status: progress === 100 ? 'completed' : 'processing'
                    });

                    // Broadcast progress
                    this.broadcastProgress(operationId, progress, i + 1, numbersToProcess);

                    // Delay between additions
                    await this.delay(3000);

                } catch (memberError) {
                    if (memberError.message.includes('full')) {
                        results.stoppedDueToFull = true;
                        results.failed.push({
                            number: phoneNumbers[i],
                            error: 'Group became full during processing'
                        });
                        break;
                    }
                    results.failed.push({
                        number: phoneNumbers[i],
                        error: memberError.message
                    });
                }
            }

            // Get updated group info
            let updatedGroupInfo = null;
            try {
                updatedGroupInfo = await this.client.getGroupInfo(groupLink);
            } catch (infoError) {
                console.error('Failed to get updated group info:', infoError);
            }

            // Finalize operation
            const finalStatus = results.stoppedDueToFull ? 'stopped' : 'completed';
            this.boostOperations.set(operationId, {
                ...this.boostOperations.get(operationId),
                status: finalStatus,
                progress: finalStatus === 'stopped' ? 
                    Math.round((results.success.length / numbersToProcess) * 100) : 100,
                completed: results.success.length,
                endTime: Date.now(),
                results: results,
                groupInfo: updatedGroupInfo || groupInfo
            });

            return {
                success: results.success.length > 0,
                operationId,
                results,
                groupInfo: updatedGroupInfo || groupInfo,
                stoppedDueToFull: results.stoppedDueToFull,
                message: results.stoppedDueToFull ? 
                    'Process stopped because group became full' : 
                    'Process completed successfully'
            };

        } catch (error) {
            this.boostOperations.set(operationId, {
                ...this.boostOperations.get(operationId),
                status: 'failed',
                error: error.message
            });
            return { success: false, error: error.message };
        }
    }

    getOperationStatus(operationId) {
        if (!this.boostOperations.has(operationId)) {
            return { success: false, error: 'Operation not found' };
        }
        return { 
            success: true, 
            operation: this.boostOperations.get(operationId) 
        };
    }

    getAllOperations() {
        return Array.from(this.boostOperations.entries()).map(([id, data]) => ({
            id,
            type: data.type,
            status: data.status,
            progress: data.progress,
            completed: data.completed,
            total: data.total,
            startTime: data.startTime
        }));
    }

    broadcastProgress(operationId, progress, completed, total) {
        // This would typically use WebSockets to send real-time updates
        // For now, we'll just log it
        console.log(`Operation ${operationId}: ${progress}% complete (${completed}/${total})`);
        
        // In a real implementation, you would emit a Socket.IO event:
        // io.emit('progress-update', { operationId, progress, completed, total });
    }

    cleanupOldSessions(maxAge = 3600000) { // 1 hour
        const now = Date.now();
        for (const [sessionId, session] of this.activeSessions.entries()) {
            if (now - session.lastActivity > maxAge) {
                session.client.disconnect();
                this.activeSessions.delete(sessionId);
            }
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    disconnectSession(sessionId) {
        if (this.activeSessions.has(sessionId)) {
            const session = this.activeSessions.get(sessionId);
            session.client.disconnect();
            this.activeSessions.delete(sessionId);
            return true;
        }
        return false;
    }
}

module.exports = WhatsAppHandler;