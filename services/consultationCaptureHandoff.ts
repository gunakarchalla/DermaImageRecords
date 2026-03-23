const NEW_CONSULTATION_KEY = "__new__";

const captureQueueByConsultation = new Map<string, string[]>();

function toConsultationKey(patientId: string, consultationId?: string) {
    return `${patientId}::${consultationId ?? NEW_CONSULTATION_KEY}`;
}

export function enqueueConsultationCapture(
    patientId: string,
    photoUri: string,
    consultationId?: string,
) {
    const consultationKey = toConsultationKey(patientId, consultationId);
    const existingQueue = captureQueueByConsultation.get(consultationKey) ?? [];

    captureQueueByConsultation.set(consultationKey, [...existingQueue, photoUri]);
}

export function consumeConsultationCaptureQueue(
    patientId: string,
    consultationId?: string,
) {
    const consultationKey = toConsultationKey(patientId, consultationId);
    const queue = captureQueueByConsultation.get(consultationKey) ?? [];

    captureQueueByConsultation.delete(consultationKey);
    return queue;
}
