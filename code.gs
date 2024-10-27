/**
 * Función principal para procesar los correos electrónicos entrantes.
 * Recorre los hilos sin etiquetas y determina la acción a tomar
 * basándose en el último mensaje de cada hilo.
 */
function procesarCorreos() {
  var labelName = "PROCESSED";
  var label = getOrCreateLabel(labelName);

  // Buscar hilos en la bandeja de entrada sin etiquetas
  var threads = GmailApp.search('in:inbox -in:trash -in:spam -has:userlabels');

  if (threads.length === 0) {
    Logger.log('No hay nuevos tickets.');
    return;
  }

  // Procesar cada hilo encontrado
  threads.forEach(function(thread) {
    var mensajes = thread.getMessages();
    var ultimoMensaje = mensajes[mensajes.length - 1];

    // Determinar la acción a tomar con el último mensaje
    var datos = determinarAccion(ultimoMensaje, mensajes);

    if (datos.Action === 'CREATE') {
      crearTicket(ultimoMensaje);
    } else if (datos.Action === 'RESPOND') {
      procesarHilo(thread);
    } else if (datos.Action === 'CLOSE') {
      cerrarTicket(thread, datos.Reply);
    }

    // Marcar el último mensaje como leído
    ultimoMensaje.markRead();

    // Etiquetar y archivar el hilo
    label.addToThread(thread);
    thread.moveToArchive();
  });
}

/**
 * Obtiene una etiqueta de Gmail por su nombre o la crea si no existe.
 *
 * @param {string} labelName - El nombre de la etiqueta.
 * @returns {GmailLabel} - La etiqueta de Gmail.
 */
function getOrCreateLabel(labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  return label;
}

/**
 * Determina la acción a realizar en base al último mensaje y el historial del hilo.
 *
 * @param {GmailMessage} ultimoMensaje - El último mensaje del hilo.
 * @param {GmailMessage[]} mensajes - Todos los mensajes del hilo.
 * @returns {Object} - Un objeto con la acción a realizar y una respuesta si corresponde.
 */
function determinarAccion(ultimoMensaje, mensajes) {
  var esNuevoTicket = mensajes.length === 1;
  var contenidoMensaje = ultimoMensaje.getPlainBody();

  if (esNuevoTicket) {
    return {
      "Action": "CREATE"
    };
  } else {
    // Analizar el contenido del último mensaje para determinar si es cierre de ticket
    var datos = analizarCierreTicket(contenidoMensaje);
    return datos;
  }
}

/**
 * Analiza el contenido del mensaje para determinar si el usuario desea cerrar el ticket o requiere una respuesta.
 *
 * @param {string} contenidoCorreo - El contenido del correo electrónico.
 * @returns {Object} - Un objeto con la acción a realizar ("CLOSE" o "RESPOND") y una respuesta generada.
 */
function analizarCierreTicket(contenidoCorreo) {
  var apiKey = getApiKey("MISTRAL_API_KEY");
  var url = 'https://api.mistral.ai/v1/chat/completions';

  var archivo = {
    "Reply": "Crea un mensaje de cierre y agradecimiento en el mismo idioma que el mensaje",
    "Action": "Analiza el contenido del mensaje e indica si el usuario quiere alguna de estas dos opciones: CLOSE o RESPOND"
  };

  var payload = {
    'model': "mistral-medium", // Reemplazar con el modelo de Mistral adecuado
    'response_format': { type: "json_object" },
    'messages': [
      {
        'role': 'system',
        'content': `Analiza el contenido del mensaje e indica si el usuario quiere alguna de estas dos opciones: CLOSE o RESPOND.

Contenido del mensaje:
"${contenidoCorreo}"

Completa el objeto JSON. El atributo "Action" debe ser "CLOSE" o "RESPOND".`
      },
      { 'role': 'user', 'content': JSON.stringify(archivo) }
    ]
  };

  var options = {
    'method': 'post',
    'contentType': 'application/json',
    'headers': {
      'Authorization': 'Bearer ' + apiKey
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var result = JSON.parse(response.getContentText());

    if (result.choices && result.choices.length > 0) {
      var assistantResponse = result.choices[0].message.content;
      var datos = JSON.parse(assistantResponse);
      return datos;
    } else {
      Logger.log('Formato de respuesta inesperado de Mistral API: ' + JSON.stringify(result));
      return { "Action": "RESPOND" };
    }
  } catch (e) {
    Logger.log('Error al llamar a la API de Mistral: ' + e);
    return { "Action": "RESPOND" };
  }
}

/**
 * Crea un nuevo ticket a partir del mensaje recibido, validando que no exista ya un ticket con el mismo ID.
 *
 * @param {GmailMessage} mensaje - El mensaje de correo electrónico recibido.
 */
function crearTicket(mensaje) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = spreadsheet.getSheetByName('Tickets');

  // Obtener el ID del mensaje
  var mensajeId = mensaje.getId();

  // Validar si ya existe un ticket con el mismo ID
  if (ticketExiste(mensajeId)) {
    Logger.log('El ticket con ID ' + mensajeId + ' ya existe. No se creará un nuevo ticket.');
    return; // Salir de la función si el ticket ya existe
  }

  var mensajeCompleto = mensaje.getSubject() + '\n' +
    mensaje.getFrom() + '\n' +
    mensaje.getTo() + '\n' +
    mensaje.getDate() + '\n\n' +
    mensaje.getPlainBody();

  // Obtener el enlace al mensaje
  var enlaceMensaje = 'https://mail.google.com/mail/u/0/#inbox/' + mensajeId;

  // Enviar el contenido a Mistral para extraer datos relevantes
  var datosExtraidos = extraerDatosConMistral(mensajeCompleto);

  if (datosExtraidos) {
    // Agregar los datos a la hoja de cálculo
    hoja.appendRow([
      mensajeId,
      datosExtraidos.Info,
      datosExtraidos.Origin,
      datosExtraidos.Category,
      1, // Cantidad de mensajes
      datosExtraidos.Created,
      datosExtraidos.Created,
      datosExtraidos.Sender,
      "NEW",
      datosExtraidos.Confidence,
      enlaceMensaje
    ]);

    // Si la categoría no es 'NOTHING TO DO WITH', enviar a CodeGPT
    if (datosExtraidos.Category !== 'NOTHING TO DO WITH') {
      // Generar la respuesta definitiva con CodeGPT
      var respuestaDefinitiva = obtenerRespuestaCodeGPT(mensaje.getPlainBody());

      if (respuestaDefinitiva) {
        var respuestaHTML = convertirMarkdownAHTML(respuestaDefinitiva);
        // Enviar el correo al usuario con la respuesta definitiva
        enviarCorreoRespuesta(datosExtraidos.SenderEmail || mensaje.getFrom(), respuestaHTML, mensaje.getSubject());

        // Actualizar el estado a 'OPEN' en la hoja de cálculo
        actualizarEstadoTicket(mensajeId, 'OPEN', 1);
      }
    } else {
      // Si no tiene que ver con el tema, cerrar el ticket
      actualizarEstadoTicket(mensajeId, 'CLOSED', 1);
    }
  } else {
    Logger.log('No se pudieron extraer datos del correo con ID: ' + mensajeId);
  }
}


/**
 * Procesa un hilo de correo existente para generar una respuesta al usuario.
 *
 * @param {GmailThread} thread - El hilo de correo a procesar.
 */
function procesarHilo(thread) {
  var mensajes = thread.getMessages();
  var ticketID = mensajes[0].getId();
  var remitente = mensajes[0].getFrom();
  var contenidoAgregado = '';
  Logger.log('Procesando el hilo con ID: ' + ticketID);

  // Acumular el contenido de todos los mensajes
  mensajes.forEach(function(mensaje) {
    contenidoAgregado += '\n\n' + mensaje.getPlainBody();
    mensaje.markRead();
  });

  // Generar la respuesta con CodeGPT
  var respuestaDefinitiva = obtenerRespuestaCodeGPT(contenidoAgregado);

  if (respuestaDefinitiva) {
    var respuestaHTML = convertirMarkdownAHTML(respuestaDefinitiva);
    enviarCorreoRespuesta(remitente, respuestaHTML, thread.getFirstMessageSubject());
  }

  // Actualizar el estado del ticket a 'PENDING'
  actualizarEstadoTicket(ticketID, 'PENDING', mensajes.length);
}

/**
 * Cierra un ticket y envía un mensaje de despedida al usuario.
 *
 * @param {GmailThread} thread - El hilo de correo asociado al ticket.
 * @param {string} despedida - Mensaje de cierre y agradecimiento para el usuario.
 */
function cerrarTicket(thread, despedida) {
  var mensajes = thread.getMessages();
  var ticketID = mensajes[0].getId();

  // Actualizar el estado del ticket a 'CLOSED'
  actualizarEstadoTicket(ticketID, 'CLOSED', mensajes.length);

  // Enviar correo de cierre al usuario
  enviarCorreoRespuesta(mensajes[0].getFrom(), despedida, mensajes[0].getSubject());

  Logger.log('El ticket con ID ' + ticketID + ' ha sido cerrado.');
}

/**
 * Actualiza el estado de un ticket en la hoja de cálculo.
 *
 * @param {string} ticketID - El ID del ticket (ID del mensaje).
 * @param {string} nuevoEstado - El nuevo estado del ticket ('OPEN', 'PENDING', 'CLOSED').
 * @param {number} cantidadMensajes - La cantidad total de mensajes en el hilo.
 */
function actualizarEstadoTicket(ticketID, nuevoEstado, cantidadMensajes) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tickets');
  var rangoID = hoja.getRange('A:A'); // Columna A donde están los IDs
  var textFinder = rangoID.createTextFinder(ticketID);
  var celdaEncontrada = textFinder.findNext();

  if (celdaEncontrada) {
    var fila = celdaEncontrada.getRow();
    hoja.getRange(fila, 9).setValue(nuevoEstado); // Columna I es 'Estado'
    hoja.getRange(fila, 7).setValue(new Date());  // Columna G es 'Updated'
    hoja.getRange(fila, 5).setValue(cantidadMensajes); // Columna E es 'Cantidad de mensajes'
  } else {
    Logger.log('No se encontró el ticket con ID: ' + ticketID);
  }
}

/**
 * Envía un correo electrónico de respuesta al usuario.
 *
 * @param {string} destinatario - Dirección de correo electrónico del destinatario.
 * @param {string} contenidoRespuesta - Contenido del correo electrónico (en formato HTML).
 * @param {string} asuntoOriginal - Asunto del mensaje original.
 */
function enviarCorreoRespuesta(destinatario, contenidoRespuesta, asuntoOriginal) {
  var asuntoRespuesta = 'Re: ' + asuntoOriginal;

  MailApp.sendEmail({
    to: destinatario,
    subject: asuntoRespuesta,
    htmlBody: contenidoRespuesta
  });
}

/**
 * Extrae datos relevantes del correo electrónico utilizando la API de Mistral.
 *
 * @param {string} contenidoCorreo - El contenido completo del correo electrónico.
 * @returns {Object|null} - Un objeto con los datos extraídos o null si ocurre un error.
 */
function extraerDatosConMistral(contenidoCorreo) {
  var apiKey = getApiKey("MISTRAL_API_KEY");
  var url = 'https://api.mistral.ai/v1/chat/completions';

  var archivo = {
    "Language": "Identify the language of the email, from now on you must respond in the identified language",
    "Info": "Create a descriptive title for the ticket the user is requesting",
    "Origin": "Since this ticket comes through Gmail, just put GMAIL. In the future, there will be other channels",
    "Category": "Select which category the ticket belongs to: Create, Improve, Adapt, Modify, NOTHING TO DO WITH",
    "Created": "Creation date in the following format: MMM DD, YYYY",
    "Sender": "Name of the person requesting the ticket or email",
    "Confidence": "Confidence level in related to prompt engineering (0 to 1)"
  };

  var prompt = `Your task is to extract relevant information from emails related to prompt engineering and return a JSON object with the extracted data. If the request in the email is not related to prompt engineering, set the "Category" attribute to "NOTHING TO DO WITH".

You MUST detect the language of the email and respond in the same language.

Email content:
"${contenidoCorreo}"

Complete the JSON object. Ensure you respond in the same language as the "Language" attribute.`;

  var payload = {
    'model': "mistral-medium", // Reemplazar con el modelo de Mistral adecuado
    'response_format': { type: "json_object" },
    'messages': [
      { 'role': 'system', 'content': prompt },
      { 'role': 'user', 'content': JSON.stringify(archivo) }
    ]
  };

  var options = {
    'method': 'post',
    'contentType': 'application/json',
    'headers': {
      'Authorization': 'Bearer ' + apiKey
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var result = JSON.parse(response.getContentText());

    if (result.choices && result.choices.length > 0) {
      var assistantResponse = result.choices[0].message.content;
      var datos = JSON.parse(assistantResponse);
      return datos;
    } else {
      Logger.log('Formato de respuesta inesperado de Mistral API: ' + JSON.stringify(result));
      return null;
    }
  } catch (e) {
    Logger.log('Error al llamar a la API de Mistral: ' + e);
    return null;
  }
}

/**
 * Genera una respuesta al correo electrónico utilizando la API de CodeGPT.
 *
 * @param {string} contenidoCorreo - El contenido del correo electrónico.
 * @returns {string|null} - La respuesta generada o null si ocurre un error.
 */
function obtenerRespuestaCodeGPT(contenidoCorreo) {
  var apiKey = getApiKey("CODEGPT_API_KEY");
  var agentId = getApiKey("CODEGPT_AGENT_ID");

  var options = {
    method: 'POST',
    contentType: 'application/json',
    headers: {
      'accept': 'application/json',
      'authorization': 'Bearer ' + apiKey
    },
    payload: JSON.stringify({
      stream: false,
      agentId: agentId,
      messages: [{ content: contenidoCorreo, role: 'user' }],
      format: 'json'
    }),
    muteHttpExceptions: true
  };

  var url = 'https://api.codegpt.co/api/v1/chat/completions';

  try {
    var response = UrlFetchApp.fetch(url, options);
    var result = JSON.parse(response.getContentText());

    if (result.choices && result.choices.length > 0) {
      var assistantResponse = result.choices[0].message.completion;
      return assistantResponse; // Devolvemos la respuesta del asistente
    } else {
      Logger.log('Formato de respuesta inesperado de CodeGPT: ' + JSON.stringify(result));
      return null;
    }
  } catch (e) {
    Logger.log('Error al llamar a la API de CodeGPT: ' + e);
    return null;
  }
}

/**
 * Convierte texto en formato Markdown a HTML.
 *
 * @param {string} markdown - El texto en formato Markdown.
 * @returns {string} - El texto convertido a HTML.
 */
function convertirMarkdownAHTML(markdown) {
  var converter = new showdown.Converter();
  return converter.makeHtml(markdown);
}

/**
 * Verifica si un ticket con el ID proporcionado ya existe en la hoja de cálculo.
 *
 * @param {string} ticketID - El ID del ticket (ID del mensaje).
 * @returns {boolean} - Retorna true si el ticket existe, false en caso contrario.
 */
function ticketExiste(ticketID) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tickets');
  var rangoID = hoja.getRange('A:A'); // Columna A donde están los IDs
  var textFinder = rangoID.createTextFinder(ticketID);
  var celdaEncontrada = textFinder.findNext();

  return celdaEncontrada !== null;
}


/**
 * Obtiene la clave API almacenada en las propiedades del script.
 *
 * @param {string} key - El nombre de la propiedad que contiene la clave API.
 * @returns {string} - La clave API.
 */
function getApiKey(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}
